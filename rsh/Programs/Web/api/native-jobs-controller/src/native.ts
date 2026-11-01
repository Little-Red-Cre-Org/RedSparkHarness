/** Authenticated read-only browser access to Agent-owned background jobs. */
import { z } from 'zod'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-client-connection/native-host'
import type { NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type { NativeJobRegistry, NativeJobSnapshot } from '@deepseek-ai/dsh-native-jobs'
import type { NativeSessionJob, NativeSessionJobsFrame } from '@deepseek-ai/dsh-client-native-session/jobs-types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

const emptyRequest = z.strictObject({})
const jobsEndpoints = new Set(['session/jobs/list'])

/**
 * Floor between two registry re-reads on one follow stream.
 *
 * The jobs registry exposes no change subscription, so the feed polls. Without
 * a floor a drained stream would re-read on every event-loop turn; one second
 * matches the schedule feed's effective cadence while staying well under a
 * human's perception of a stale list.
 */
export const MIN_POLL_INTERVAL_MS = 1000

/**
 * Project one registry snapshot into the browser-safe row.
 *
 * `owner` is dropped deliberately: the browser keys on `sessionId`, and an
 * Agent object cannot cross the transport. Everything else is already a plain
 * scalar the job list header renders.
 * @param snapshot - Agent-owned job view read from the registry.
 * @param sessionId - Session that owns the job.
 * @returns detached browser row.
 */
function projectJob(snapshot: NativeJobSnapshot, sessionId: SessionId): NativeSessionJob {
  return {
    id: String(snapshot.id),
    sessionId,
    kind: snapshot.kind,
    label: snapshot.label,
    status: snapshot.status,
    ...snapshot.detail === undefined ? {} : { detail: snapshot.detail },
    startedAt: snapshot.startedAt,
    ...snapshot.finishedAt === undefined ? {} : { finishedAt: snapshot.finishedAt },
  }
}

/** Snapshot every job the Host currently holds, grouped by owning Session. */
function projectAll(agents: NativeAgentRegistry, jobs: NativeJobRegistry): Map<SessionId, NativeSessionJob[]> {
  const bySession = new Map<SessionId, NativeSessionJob[]>()
  for (const agent of agents.list()) {
    const sessionId = agent.id as unknown as SessionId
    for (const snapshot of jobs.list(agent)) {
      const row = projectJob(snapshot, sessionId)
      const bucket = bySession.get(sessionId)
      if (bucket === undefined) bySession.set(sessionId, [row])
      else bucket.push(row)
    }
  }
  return bySession
}

function sameJob(left: NativeSessionJob, right: NativeSessionJob): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * One committed change set over the whole job registry.
 *
 * The jobs registry exposes no change subscription, so the feed re-reads it and
 * derives a delta. The transport shape stays identical to the schedule feed
 * while the Host keeps ownership of the truth; a future registry-owned
 * notification can replace the re-read without touching the browser contract.
 */
function diffJobs(
  previous: Map<SessionId, NativeSessionJob[]>,
  current: Map<SessionId, NativeSessionJob[]>,
): NativeSessionJobsFrame[] {
  const frames: NativeSessionJobsFrame[] = []
  for (const [sessionId, next] of current) {
    const prior = previous.get(sessionId) ?? []
    const priorById = new Map(prior.map(job => [job.id, job]))
    for (const job of next) {
      const before = priorById.get(job.id)
      if (before === undefined || !sameJob(before, job)) frames.push({ type: 'upsert', job })
    }
    for (const job of prior) {
      if (!next.some(candidate => candidate.id === job.id)) frames.push({ type: 'remove', id: job.id })
    }
  }
  for (const [sessionId, prior] of previous) {
    if (current.has(sessionId)) continue
    for (const job of prior) frames.push({ type: 'remove', id: job.id })
    frames.push({ type: 'session-gone', sessionId })
  }
  return frames
}

/** Flatten grouped rows into one registration-ordered list. */
function flatten(state: Map<SessionId, NativeSessionJob[]>): NativeSessionJob[] {
  return [...state.values()].flat().sort((left, right) => left.startedAt - right.startedAt)
}

/** One answer to a session/jobs/list request: the rows, or a generic failure. */
type JobsListResult =
  | { readonly ok: true; readonly value: NativeSessionJob[] }
  | { readonly ok: false; readonly error: JobsListFailure }

/** The generic failure a jobs request answers with. */
type JobsListFailure = {
  readonly code: string
  readonly message: string
  readonly details: Record<string, unknown>
}

/**
 * Host-side projection of the Native job registry onto browser-safe rows.
 *
 * Reads the registry on demand rather than subscribing to it: the registry
 * publishes no change notification, so the follow feed re-reads at most once
 * per interval and diffs the result.
 */
export class NativeJobsController {
  private state: Map<SessionId, NativeSessionJob[]>
  // A fresh controller has no previous re-read, so the first one is never held back.
  private lastPollAt: number | undefined
  constructor(private readonly agents: NativeAgentRegistry, private readonly jobs: NativeJobRegistry,
    private readonly minPollIntervalMs: number = MIN_POLL_INTERVAL_MS) {
    this.state = projectAll(agents, jobs)
  }

  /**
   * Read the current list without advancing the delta cursor.
   * @returns every tracked job, ordered by start time.
   */
  list(): NativeSessionJob[] {
    return flatten(this.state)
  }

  /**
   * Milliseconds to wait before the next registry re-read is allowed.
   * @param now - injectable clock reading, so a test can drive the interval.
   * @returns 0 when the interval already elapsed, otherwise the remaining slice.
   */
  nextPollDelay(now: number = Date.now()): number {
    if (this.lastPollAt === undefined) return 0
    const elapsed = now - this.lastPollAt
    return elapsed >= this.minPollIntervalMs ? 0 : this.minPollIntervalMs - elapsed
  }

  /**
   * Re-read the registry and return everything that changed since the last poll.
   * @param now - injectable clock reading, recorded as this poll's timestamp.
   * @returns the upsert, remove and session-gone frames the change produced.
   */
  poll(now: number = Date.now()): NativeSessionJobsFrame[] {
    this.lastPollAt = now
    const next = projectAll(this.agents, this.jobs)
    const delta = diffJobs(this.state, next)
    this.state = next
    return delta
  }

  /**
   * Answer one /api/session/jobs/list request.
   * @param endpoint - the RPC endpoint name being answered.
   * @param payload - request body; the endpoint accepts an empty object.
   * @param signal - caller cancellation.
   * @returns an ok result carrying every row, or a generic failure.
   */
  handle(endpoint: string, payload: unknown, signal: AbortSignal): Promise<JobsListResult> {
    try {
      if (!jobsEndpoints.has(endpoint)) throw new Error('unsupported jobs endpoint')
      emptyRequest.parse(payload)
      signal.throwIfAborted()
      const next = projectAll(this.agents, this.jobs)
      this.state = next
      return Promise.resolve({ ok: true as const, value: flatten(next) })
    } catch {
      signal.throwIfAborted()
      return Promise.resolve({ ok: false as const, error: {
        code: 'native/jobs', message: 'Job request failed.', details: {},
      } })
    }
  }

  /**
   * Serve the /api/session/jobs/follow SSE feed.
   * @param request - the incoming Fetch request; the body must be an empty object.
   * @param lifetime - the plugin's lifetime signal, aborted when it unloads.
   * @returns a streamed event response, or 400 when the body is not an empty object.
   */
  async follow(request: Request, lifetime: AbortSignal): Promise<Response> {
    try { emptyRequest.parse(await request.json()) }
    catch { return new Response(null, { status: 400 }) }
    const signal = AbortSignal.any([request.signal, lifetime])
    const baseline = this.list()
    const encoder = new TextEncoder()
    const nextPollDelay = (): number => this.nextPollDelay()
    const poll = (): NativeSessionJobsFrame[] => this.poll()
    const body = new ReadableStream<Uint8Array>({
      start: (stream) => {
        stream.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'baseline', jobs: baseline })}\n\n`))
      },
      pull: async (stream) => {
        if (signal.aborted) { stream.close(); return }
        // The registry has no change subscription, so this feed polls. Keep the
        // re-read off the event loop's spin path: one pull waits out the
        // remaining slice of the minimum interval before touching the registry.
        const wait = nextPollDelay()
        if (wait > 0) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, wait)
            signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
          })
        }
        for (const frame of poll()) stream.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
      },
      cancel: () => { /* the request signal owns teardown */ },
    }, { highWaterMark: 0 })
    return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } })
  }
}

/**
 * Native Web background-job endpoint Consumer over the registry and Connection.
 *
 * The browser surface needs one list per Session, so rows are keyed by the
 * owning Agent id (the Session id) and carried over the same intercepted-RPC
 * plus SSE-follow pair the schedule card already uses.
 */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-native-jobs-controller',
  targets: ['host'],
  requires: ['hostConnection', 'agents', 'jobs'],
  optional: [],
  provides: [],
  resolve() {
    return (context) => {
      const controller = new NativeJobsController(context.require('agents'), context.require('jobs'))
      context.own(context.require('hostConnection').rpc.intercept('/api', endpoint => jobsEndpoints.has(endpoint),
        (endpoint, payload, signal) => controller.handle(endpoint, payload, signal)))
      context.own(context.require('hostConnection').fetch.register({
        path: '/api/session/jobs/follow', methods: ['POST'], requestBody: 'buffered',
        fetch: request => controller.follow(request, context.signal),
      }))
    }
  },
}
