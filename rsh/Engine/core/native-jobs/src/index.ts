/** Native Agent-owned background work registry for native Host profiles. */
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeAgent, NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { jobs: NativeJobRegistry }
}

/** Opaque identifier assigned to one native background job. */
export type NativeJobId = Branded<'NativeJobId'>

/**
 * Brand a native job id after its registry-generated string was validated.
 * @param value - kind-prefixed registry id to brand.
 * @returns the opaque native job id.
 */
export function NativeJobId(value: string): NativeJobId {
  if (!/^[a-z][a-z0-9-]*-[1-9][0-9]*$/.test(value)) throw new Error(`native-jobs: invalid id ${JSON.stringify(value)}`)
  return brandString<NativeJobId>(value)
}

/** A job is live until its cooperative runner resolves its terminal outcome. */
export type NativeJobStatus = 'running' | 'stopping' | 'completed' | 'failed' | 'cancelled'

/** Runner-produced terminal facts. A runner resolves rather than throwing for an expected operational failure. */
export interface NativeJobOutcome {
  readonly status: Exclude<NativeJobStatus, 'running' | 'stopping'>
  readonly detail?: string
  readonly output?: string
}

/** Immutable view of one Agent-owned job. */
export interface NativeJobSnapshot {
  readonly id: NativeJobId
  readonly kind: string
  readonly label: string
  readonly owner: NativeAgent
  readonly status: NativeJobStatus
  readonly startedAt: number
  readonly finishedAt?: number
  readonly detail?: string
}

/** Work admitted under one exact live Agent. */
export interface NativeJobStart {
  readonly agent: NativeAgent
  readonly kind: string
  readonly label: string
  /** Run cooperative work; cancellation reaches it through the supplied signal. */
  run(signal: AbortSignal): Promise<NativeJobOutcome>
}

interface Entry {
  readonly id: NativeJobId
  readonly kind: string
  readonly label: string
  readonly agent: NativeAgent
  readonly startedAt: number
  readonly controller: AbortController
  readonly completed: PromiseWithResolvers<NativeJobSnapshot>
  releaseAgentCleanup: (() => void) | undefined
  status: NativeJobStatus
  finishedAt: number | undefined
  detail: string | undefined
  output: string | undefined
}

const JOB_KIND = /^[a-z][a-z0-9-]*$/

function failure(error: unknown): NativeJobOutcome {
  return { status: 'failed', detail: error instanceof Error ? error.message : String(error) }
}

/**
 * Owns Agent-scoped background work. The registry records only lifecycle and
 * final output; applications decide whether and how either enters a Session.
 */
export class NativeJobRegistry {
  private readonly entries = new Map<NativeJobId, Entry>()
  private readonly nextByKind = new Map<string, number>()
  private state: 'active' | 'closing' | 'disposed' = 'active'
  private disposal: Promise<void> | undefined

  /**
   * @param agents - exact Agent registry used for admission and access fences.
   * @param maxConcurrentPerAgent - live-job ceiling for each exact Agent.
   */
  constructor(private readonly agents: NativeAgentRegistry, private readonly maxConcurrentPerAgent: number) {
    if (!Number.isSafeInteger(maxConcurrentPerAgent) || maxConcurrentPerAgent < 1) {
      throw new Error('native-jobs: maxConcurrentPerAgent must be a positive safe integer')
    }
  }

  /**
   * Admit one runner and return its kind-prefixed id. A synchronous throw or
   * rejected runner settles its record as failed instead of escaping detached.
   * @param spec - exact Agent owner and cooperative runner.
   * @returns the registry-assigned job id.
   */
  start(spec: NativeJobStart): NativeJobId {
    this.assertActive()
    this.assertAgent(spec.agent)
    if (!JOB_KIND.test(spec.kind)) throw new Error('native-jobs: kind must be lowercase hyphenated')
    if (spec.label.length === 0) throw new Error('native-jobs: label must be nonempty')
    if (this.activeCount(spec.agent) >= this.maxConcurrentPerAgent) {
      throw new Error(`native-jobs: live-job limit reached for Agent ${JSON.stringify(spec.agent.id)} (limit: ${this.maxConcurrentPerAgent})`)
    }
    const number = (this.nextByKind.get(spec.kind) ?? 0) + 1
    this.nextByKind.set(spec.kind, number)
    const entry: Entry = {
      id: NativeJobId(`${spec.kind}-${number}`), kind: spec.kind, label: spec.label, agent: spec.agent,
      startedAt: Date.now(), controller: new AbortController(), completed: Promise.withResolvers(),
      releaseAgentCleanup: undefined, status: 'running', finishedAt: undefined, detail: undefined, output: undefined,
    }
    this.entries.set(entry.id, entry)
    entry.releaseAgentCleanup = this.agents.onDispose(spec.agent, async () => {
      const owned = [...this.entries.values()].filter(candidate => candidate.agent === spec.agent)
      for (const candidate of owned) {
        if (candidate.status === 'running') candidate.status = 'stopping'
        candidate.controller.abort('native Agent released')
      }
      await Promise.allSettled(owned.map(candidate => candidate.completed.promise))
    })
    let run: Promise<NativeJobOutcome>
    try {
      run = spec.run(entry.controller.signal)
    } catch (error) {
      this.settle(entry, failure(error))
      return entry.id
    }
    void Promise.resolve(run).then(
      (outcome) => { this.settle(entry, outcome) },
      (error: unknown) => { this.settle(entry, failure(error)) },
    )
    return entry.id
  }

  /**
   * Return a detached registration-order view of jobs owned by one exact Agent.
   * @param agent - exact registered Agent that owns the selected jobs.
   * @returns owned job snapshots in registration order.
   */
  list(agent: NativeAgent): NativeJobSnapshot[] {
    this.assertReadable()
    this.assertAgent(agent)
    return [...this.entries.values()].filter(entry => entry.agent === agent).map(entry => this.snapshot(entry))
  }

  /**
   * Return one detached owned-job view.
   * @param id - registry id to resolve.
   * @param agent - exact registered Agent that owns the job.
   * @returns one owned job snapshot.
   */
  get(id: NativeJobId, agent: NativeAgent): NativeJobSnapshot {
    this.assertReadable()
    return this.snapshot(this.access(id, agent))
  }

  /**
   * Return final output after settlement, or an empty string while the job remains live.
   * @param id - registry id to read.
   * @param agent - exact registered Agent that owns the job.
   * @returns output together with its current job snapshot.
   */
  read(id: NativeJobId, agent: NativeAgent): { readonly output: string; readonly snapshot: NativeJobSnapshot } {
    this.assertReadable()
    const entry = this.access(id, agent)
    return { output: entry.status === 'running' || entry.status === 'stopping' ? '' : entry.output ?? '', snapshot: this.snapshot(entry) }
  }

  /**
   * Request cooperative cancellation. The runner's eventual terminal outcome remains authoritative.
   * @param id - registry id to cancel.
   * @param agent - exact registered Agent that owns the job.
   * @param reason - optional cancellation reason passed to the runner.
   * @returns whether cancellation was requested or the job had already settled.
   */
  cancel(id: NativeJobId, agent: NativeAgent, reason?: unknown): 'requested' | 'already-finished' {
    this.assertReadable()
    const entry = this.access(id, agent)
    if (entry.status !== 'running' && entry.status !== 'stopping') return 'already-finished'
    entry.status = 'stopping'
    entry.controller.abort(reason)
    return 'requested'
  }

  /**
   * Wait for a job to settle or for the caller-provided positive timeout to expire.
   * @param id - registry id to wait for.
   * @param agent - exact registered Agent that owns the job.
   * @param timeoutMs - positive timer bound for this wait.
   * @param signal - caller cancellation; aborting the wait does not cancel the job.
   * @returns the terminal snapshot, or the current live snapshot at timeout.
   */
  async wait(id: NativeJobId, agent: NativeAgent, timeoutMs: number, signal?: AbortSignal): Promise<NativeJobSnapshot> {
    this.assertReadable()
    const entry = this.access(id, agent)
    signal?.throwIfAborted()
    if (entry.status !== 'running' && entry.status !== 'stopping') return this.snapshot(entry)
    if (!(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2_147_483_647)) {
      throw new Error('native-jobs: timeoutMs must be a positive finite timer delay')
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let rejectAborted: (() => void) | undefined
    try {
      return await Promise.race([
        entry.completed.promise,
        new Promise<NativeJobSnapshot>((resolve) => { timer = setTimeout(() => { resolve(this.snapshot(entry)) }, timeoutMs) }),
        new Promise<NativeJobSnapshot>((_resolve, reject) => {
          if (signal === undefined) return
          rejectAborted = () => { reject(signal.reason instanceof Error ? signal.reason : new Error('native-jobs: wait aborted', { cause: signal.reason })) }
          signal.addEventListener('abort', rejectAborted, { once: true })
          if (signal.aborted) rejectAborted()
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (rejectAborted !== undefined) signal?.removeEventListener('abort', rejectAborted)
    }
  }

  /** Stop admission, request cancellation for every live runner, and drain cooperative work. */
  dispose(): Promise<void> {
    return this.disposal ??= this.disposeInternal()
  }

  private async disposeInternal(): Promise<void> {
    if (this.state === 'active') this.state = 'closing'
    const live = [...this.entries.values()].filter(entry => entry.status === 'running' || entry.status === 'stopping')
    for (const entry of live) {
      if (entry.status === 'running') entry.status = 'stopping'
      entry.controller.abort('native job registry disposed')
    }
    await Promise.allSettled(live.map(entry => entry.completed.promise))
    this.state = 'disposed'
  }

  private access(id: NativeJobId, agent: NativeAgent): Entry {
    this.assertAgent(agent)
    const entry = this.entries.get(id)
    if (entry === undefined) throw new Error(`native-jobs: unknown job ${id}`)
    if (entry.agent !== agent) throw new Error(`native-jobs: job ${id} belongs to another Agent`)
    return entry
  }

  private activeCount(agent: NativeAgent): number {
    let count = 0
    for (const entry of this.entries.values()) {
      if (entry.agent === agent && (entry.status === 'running' || entry.status === 'stopping')) count += 1
    }
    return count
  }

  private settle(entry: Entry, outcome: NativeJobOutcome): void {
    if (entry.status !== 'running' && entry.status !== 'stopping') return
    entry.status = outcome.status
    entry.finishedAt = Date.now()
    entry.detail = outcome.detail
    entry.output = outcome.output
    entry.releaseAgentCleanup?.()
    entry.releaseAgentCleanup = undefined
    entry.completed.resolve(this.snapshot(entry))
  }

  private snapshot(entry: Entry): NativeJobSnapshot {
    return {
      id: entry.id, kind: entry.kind, label: entry.label, owner: entry.agent, status: entry.status, startedAt: entry.startedAt,
      ...entry.finishedAt === undefined ? {} : { finishedAt: entry.finishedAt },
      ...entry.detail === undefined ? {} : { detail: entry.detail },
    }
  }

  private assertAgent(agent: NativeAgent): void {
    if (this.agents.get(agent.id) !== agent) throw new Error(`native-jobs: Agent ${JSON.stringify(agent.id)} is not the registered instance`)
  }

  private assertActive(): void {
    if (this.state !== 'active') throw new Error('native-jobs: registry is disposed')
  }

  private assertReadable(): void {
    if (this.state === 'disposed') throw new Error('native-jobs: registry is disposed')
  }
}

/** Native background-job Provider with an explicit per-Agent concurrency limit. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-jobs', targets: ['host'], requires: ['agents'], provides: ['jobs'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
      throw new Error('native-jobs: configuration must be an object')
    }
    const fields = input as Record<string, unknown> | undefined
    if (fields !== undefined && Object.keys(fields).some(key => key !== 'maxConcurrentPerAgent')) {
      throw new Error('native-jobs: unknown configuration field')
    }
    const configuredLimit: unknown = fields?.maxConcurrentPerAgent ?? 10
    if (typeof configuredLimit !== 'number' || !Number.isSafeInteger(configuredLimit) || configuredLimit < 1) {
      throw new Error('native-jobs: maxConcurrentPerAgent must be a positive safe integer')
    }
    const maxConcurrentPerAgent = configuredLimit
    return (context) => {
      const registry = new NativeJobRegistry(context.require('agents'), maxConcurrentPerAgent)
      context.own(() => registry.dispose())
      context.provide('jobs', registry)
    }
  },
}
