/**
 * Low-level JSON-RPC client for a DeepSeek Harness SDK runtime subprocess.
 * {@link HarnessClient} owns the child process: it spawns the runtime, speaks
 * the `@deepseek-ai/dsh-sdk-protocol` wire over the child's stdio, fans
 * server notifications out to subscriptions, and tears the child down through
 * Core's managed connection lifetime. The design
 * twin is the Python SDK's `HarnessClient` (`rsh/Programs/SDK/python/sdk`); both drive the
 * same runtime protocol. This client runs OUTSIDE any harness context, so it
 * uses the framework-free local `dsh-subprocess` connection Provider without
 * mounting NativeHost or Cordis.
 *
 * @module @deepseek-ai/dsh-sdk-runtime/client
 */

import { disposeChildConnection, type ChildConnectionDefinition, type ChildConnectionHandle } from '@deepseek-ai/dsh-subprocess/native'
import { createLocalChildConnectionProvider, type LocalChildConnectionProvider } from '@deepseek-ai/dsh-subprocess-local/child-connection'
import { isAbsolute } from 'node:path'
import {
  JsonRpcLineTransport,
  JsonRpcResponseError,
  type ApprovalRequestParams,
  type ApprovalRequestResult,
  type InitializeParams,
  type InitializeResult,
  type SessionPromptParams,
  type SdkPromptContentBlock,
} from '@deepseek-ai/dsh-sdk-protocol'
import type { HarnessClientOptions, HarnessNotification, NotificationFilter, RuntimeProcessOptions } from './types.ts'
import type { NativeSdkChildApprovalOutcome, NativeSdkChildApprovalRelay } from './native.ts'

const nativeChildConnection = Symbol('native SDK child connection')
const nativeApprovalRelay = Symbol('native SDK child approval relay')

type NativeHarnessClientOptions = HarnessClientOptions & {
  [nativeChildConnection]?: { readonly definition: ChildConnectionDefinition; readonly dispose?: () => Promise<void> }
  [nativeApprovalRelay]?: NativeSdkChildApprovalRelay
}

/** Retained stderr lines used to diagnose an unexpected runtime death. */
const STDERR_TAIL_LIMIT = 400

/** Grace for the runtime's stdio streams to settle after its exit edge. */
const STREAM_SETTLE_MS = 100

/**
 * The runtime subprocess is gone or unusable: it exited, its stdio closed, or
 * it was never launchable. The message carries the exit code and a stderr
 * tail when available.
 */
export class TransportClosedError extends Error {
  /** @param message - the failure description, including any stderr tail. */
  constructor(message: string) {
    super(message)
    this.name = 'TransportClosedError'
  }
}

/** A request exceeded {@link HarnessClientOptions.requestTimeoutMs}. */
export class RequestTimeoutError extends Error {
  /** @param message - which method timed out. */
  constructor(message: string) {
    super(message)
    this.name = 'RequestTimeoutError'
  }
}

/**
 * The runtime answered outside its documented protocol (for example a
 * `session/prompt` response without `accepted: true`).
 */
export class SdkProtocolError extends Error {
  /** @param message - the protocol violation description. */
  constructor(message: string) {
    super(message)
    this.name = 'SdkProtocolError'
  }
}

interface SubscriptionState {
  readonly queue: HarnessNotification[]
  readonly waiters: { resolve: (item: HarnessNotification) => void; reject: (error: Error) => void }[]
  readonly filter: NotificationFilter | undefined
  failure: Error | undefined
}

/** One client-side notification stream returned by {@link HarnessClient.subscribe}. */
export interface NotificationSubscription extends AsyncIterable<HarnessNotification> {
  /**
   * Await the next matching notification.
   * @returns the notification; after the runtime died, drains what was
   * already delivered and then rejects; after {@link close}, rejects
   * immediately (the queue is dropped).
   */
  next(): Promise<HarnessNotification>

  /**
   * Drain one already-delivered notification without waiting.
   * @returns the next queued notification, or `undefined` when none is queued.
   */
  tryNext(): HarnessNotification | undefined

  /** Detach from the client; queued items drop and pending waiters reject. */
  close(): void
}

/** Internal producer side of a public notification subscription. */
class NotificationSubscriptionImpl implements NotificationSubscription {
  constructor(
    private readonly state: SubscriptionState,
    private readonly unsubscribe: () => void,
  ) {}

  /**
   * Await the next matching notification.
   * @returns the notification; after the runtime died, drains what was
   * already delivered and then rejects; after {@link close}, rejects
   * immediately (the queue is dropped).
   */
  next(): Promise<HarnessNotification> {
    const queued = this.state.queue.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    if (this.state.failure !== undefined) return Promise.reject(this.state.failure)
    return new Promise((resolve, reject) => {
      this.state.waiters.push({ resolve, reject })
    })
  }

  /**
   * Drain one already-delivered notification without waiting.
   * @returns the next queued notification, or `undefined` when none is queued.
   */
  tryNext(): HarnessNotification | undefined {
    return this.state.queue.shift()
  }

  /** Detach from the client; queued items drop and pending waiters reject. */
  close(): void {
    this.unsubscribe()
    // The drop is part of this method's contract; a runtime-death fail() keeps
    // the queue so already-delivered notifications remain drainable.
    this.state.queue.length = 0
    this.fail(new TransportClosedError('notification subscription closed'))
  }

  /**
   * Reject pending and future waits (delivery stops; the first failure wins).
   * Already-queued notifications remain drainable via {@link next}/{@link tryNext}.
   * @param error - the terminal failure delivered to waiters.
   */
  fail(error: Error): void {
    this.state.failure ??= error
    for (const waiter of this.state.waiters.splice(0)) waiter.reject(this.state.failure)
  }

  /**
   * Deliver one notification to a waiter or the queue when the filter
   * matches. A throwing filter fails only THIS subscription (detached, the
   * throw becomes its terminal error) — it never disturbs sibling
   * subscriptions or the transport's read loop.
   * @param notification - the wire notification to deliver.
   */
  push(notification: HarnessNotification): void {
    let matches: boolean
    try {
      matches = this.state.filter === undefined || this.state.filter(notification)
    } catch (error) {
      this.unsubscribe()
      this.fail(error instanceof Error ? error : new Error(String(error)))
      return
    }
    if (!matches) return
    const waiter = this.state.waiters.shift()
    if (waiter !== undefined) waiter.resolve(notification)
    else this.state.queue.push(notification)
  }

  /**
   * Iterate notifications until the subscription or runtime closes (the
   * terminating rejection propagates).
   * @returns an async iterator over {@link next} results.
   */
  async * [Symbol.asyncIterator](): AsyncIterator<HarnessNotification> {
    for (;;) yield await this.next()
  }
}

/**
 * JSON-RPC client for the DeepSeek Harness SDK runtime over subprocess stdio.
 *
 * The subprocess starts lazily on {@link start} and is owned by this instance
 * until {@link close}, which requests protocol `shutdown`, gives protocol
 * writes a bounded flush opportunity, then closes stdin and awaits the Provider-managed process range. A
 * timed-out request stays running server-side; the explicit native-sdk
 * profile supports Session cancellation separately from request timeouts.
 */
export class HarnessClient {
  /** Original public dsh launch and timeout options for this client. */
  readonly options: HarnessClientOptions
  private readonly runtime: RuntimeProcessOptions
  private readonly hostChildConnection: ChildConnectionDefinition | undefined
  private readonly approvalRelay: NativeSdkChildApprovalRelay | undefined
  private readonly activeApprovalRequests = new Map<string, AbortController>()
  private readonly seenApprovalRequests = new Set<string>()
  private readonly approvalWork = new Set<Promise<NativeSdkChildApprovalOutcome>>()
  private runtimeDisposer: (() => Promise<void>) | undefined
  private child: ChildConnectionHandle | undefined
  private processProvider: LocalChildConnectionProvider | undefined
  private transport: JsonRpcLineTransport | undefined
  private readonly stderrTail: string[] = []
  private readonly subscriptions = new Map<string, NotificationSubscriptionImpl>()
  private readonly sessionParents = new Map<string, string>()
  private subscriptionSerial = 0
  private exitCode: number | null | undefined
  private spawnError: Error | undefined
  private rangeError: Error | undefined
  private streamsSettled: Promise<void> = Promise.resolve()
  private closeTask: Promise<void> | undefined

  /** @param options - dsh profile, patch, home, process, environment, and timeout options. */
  constructor(options: HarnessClientOptions, runtime: RuntimeProcessOptions)
  constructor(options: HarnessClientOptions = {}, runtime?: RuntimeProcessOptions) {
    const internal = options as NativeHarnessClientOptions
    const { [nativeChildConnection]: ownedConnection, [nativeApprovalRelay]: approvalRelay, ...publicOptions } = internal
    this.options = publicOptions
    this.hostChildConnection = ownedConnection?.definition
    this.approvalRelay = approvalRelay
    this.runtimeDisposer = ownedConnection?.dispose
    const selectedRuntime = runtime
    if (selectedRuntime === undefined) throw new Error('SDK runtime client requires a Program-resolved process launch')
    this.runtime = selectedRuntime
  }

  /**
   * Spawn the runtime subprocess and start reading frames. Idempotent while
   * the process is live; rejects reuse after {@link close}.
   */
  start(): void {
    if (this.closeTask !== undefined) throw new TransportClosedError('DeepSeek Harness runtime client is closed')
    if (this.child !== undefined) return
    let processProvider: LocalChildConnectionProvider | undefined
    let connection: ChildConnectionDefinition
    if (this.hostChildConnection === undefined) {
      processProvider = createLocalChildConnectionProvider()
      connection = processProvider
    } else {
      connection = this.hostChildConnection
    }
    this.processProvider = processProvider
    let child: ChildConnectionHandle
    try {
      child = connection.connect({
        argv: [this.runtime.command, ...this.runtime.args],
        cwd: this.runtime.cwd ?? process.cwd(),
        env: this.runtime.environment(),
        envMode: 'replace',
        graceMs: this.runtime.disposeGraceMs ?? 3_000,
      })
    } catch (error) {
      if (processProvider !== undefined) void processProvider.dispose().catch(() => {})
      this.processProvider = undefined
      throw error
    }
    this.child = child
    // Writes racing the runtime's death EPIPE on stdin; the exit edge below is
    // the real signal, so the stream-level error only needs to be non-fatal.
    // The timing of that race is not deterministically reproducible.
    /* v8 ignore next */
    child.stdin.on('error', () => {})
    let stderrBuffer = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk
      const newline = stderrBuffer.lastIndexOf('\n')
      if (newline >= 0) {
        this.appendStderr(stderrBuffer.slice(0, newline).split('\n'))
        stderrBuffer = stderrBuffer.slice(newline + 1)
      }
    })
    let signalStreamsSettled!: () => void
    this.streamsSettled = new Promise((resolve) => { signalStreamsSettled = resolve })
    const settled = { stderr: false, exited: false }
    const maybeSettle = (): void => {
      if (settled.stderr && settled.exited) signalStreamsSettled()
    }
    child.stderr.once('close', () => {
      if (stderrBuffer.length > 0) this.appendStderr([stderrBuffer])
      settled.stderr = true
      maybeSettle()
    })
    void child.done.then((outcome) => {
      this.exitCode = outcome.exitCode
      settled.exited = true
      maybeSettle()
      return child.waitForExit().then(() => {
        // The managed range is empty, so stdout has delivered any trailing
        // frames before closing the transport and failing remaining waiters.
        this.abortApprovalRequests(this.closedError('DeepSeek Harness runtime exited'))
        this.transport?.close()
        this.failSubscriptions(this.closedError('DeepSeek Harness runtime exited'))
      }, (error: unknown) => {
        this.rangeError = error instanceof Error ? error : new Error(String(error))
        this.abortApprovalRequests(this.closedError('DeepSeek Harness process range could not be confirmed'))
        this.transport?.close()
        this.failSubscriptions(this.closedError('DeepSeek Harness process range could not be confirmed'))
      })
    }, (error: unknown) => {
      this.spawnError = error instanceof Error ? error : new Error(String(error))
      settled.exited = true
      maybeSettle()
      this.abortApprovalRequests(this.closedError('DeepSeek Harness runtime failed to start'))
      this.transport?.close()
      this.failSubscriptions(this.closedError('DeepSeek Harness runtime failed to start'))
    })
    const transport = new JsonRpcLineTransport(child.stdout, child.stdin)
    transport.onNotification((method, params) => {
      if (method === 'approval/cancel') this.cancelApproval(params)
      this.dispatchNotification({ method, params })
    })
    transport.onRequest((method, params) => this.handleIncomingRequest(method, params))
    transport.start()
    this.transport = transport
  }

  /**
   * Perform the process-wide handshake.
   * @param params - workspace cwd plus the provider/model route.
   * @returns the runtime's wire identity.
   */
  async initialize(params: InitializeParams): Promise<InitializeResult> {
    if (params.maxSteps !== undefined && (!Number.isSafeInteger(params.maxSteps) || params.maxSteps <= 0)) {
      throw new TypeError('initialize maxSteps must be a positive safe integer')
    }
    if (params.allowedTools !== undefined
      && (!Array.isArray(params.allowedTools) || params.allowedTools.some(name => typeof name !== 'string' || name.length === 0)
        || new Set(params.allowedTools).size !== params.allowedTools.length)) {
      throw new TypeError('initialize allowedTools must be an array of unique non-empty names')
    }
    if (params.workspaceWriteRoot !== undefined
      && (typeof params.workspaceWriteRoot !== 'string' || params.workspaceWriteRoot.length === 0
        || !isAbsolute(params.workspaceWriteRoot))) {
      throw new TypeError('initialize workspaceWriteRoot must be an absolute path')
    }
    const result = await this.request('initialize', {
      ...params,
      ...this.approvalRelay === undefined ? {} : { approvalOperationId: this.approvalRelay.operationId },
    }, this.runtime.initializeTimeoutMs)
    if (!isRecord(result) || !isRecord(result.serverInfo)
      || typeof result.serverInfo.name !== 'string' || typeof result.serverInfo.version !== 'string') {
      throw new SdkProtocolError(`initialize returned no server identity: ${JSON.stringify(result)}`)
    }
    if (result.maxSteps !== undefined && (typeof result.maxSteps !== 'number'
      || !Number.isSafeInteger(result.maxSteps) || result.maxSteps <= 0)) {
      throw new SdkProtocolError(`initialize returned an invalid maxSteps value: ${JSON.stringify(result.maxSteps)}`)
    }
    if (params.maxSteps !== undefined && (result.maxSteps === undefined || result.maxSteps > params.maxSteps)) {
      throw new SdkProtocolError(`initialize did not negotiate maxSteps at or below ${String(params.maxSteps)}`)
    }
    return {
      serverInfo: { name: result.serverInfo.name, version: result.serverInfo.version },
      ...(result.maxSteps === undefined ? {} : { maxSteps: result.maxSteps }),
    }
  }

  /**
   * Queue one prompt and return its durable inbox identity.
   * @param sessionId - target session; an unknown id creates it.
   * @param contentBlocks - the user message, sent verbatim.
   * @returns the queued message id.
   */
  async prompt(sessionId: string, contentBlocks: SdkPromptContentBlock[]): Promise<string> {
    const params: SessionPromptParams = { sessionId, contentBlocks }
    const result = await this.request('session/prompt', { ...params })
    if (!isRecord(result) || typeof result.messageId !== 'string') {
      throw new SdkProtocolError(`session/prompt returned no message id: ${JSON.stringify(result)}`)
    }
    return result.messageId
  }

  /**
   * Durably steer the admitted native SDK root at its next step and wake it after a turn interruption.
   * @param sessionId - active Session owned by this runtime; idle or unknown identities reject.
   * @param contentBlocks - ordered text and encoded images, admitted through the prompt policy.
   * @returns the durable next-step message id; unsupported profiles reject.
   */
  async steer(sessionId: string, contentBlocks: SdkPromptContentBlock[]): Promise<string> {
    const result = await this.request('session/steer', { sessionId, contentBlocks })
    if (!isRecord(result) || typeof result.messageId !== 'string' || result.messageId.length === 0) {
      throw new SdkProtocolError(`session/steer returned no message id: ${JSON.stringify(result)}`)
    }
    return result.messageId
  }

  /**
   * Cancel an admitted turn on the explicit native-sdk profile and await cleanup.
   * @param sessionId - Session whose active turn to cancel; other Sessions remain running.
   * @returns false when no admitted turn was active; rejects on unsupported profiles.
   */
  async cancel(sessionId: string): Promise<boolean> {
    const result = await this.request('session/cancel', { sessionId })
    if (!isRecord(result) || typeof result.cancelled !== 'boolean') {
      throw new SdkProtocolError(`session/cancel returned no cancellation result: ${JSON.stringify(result)}`)
    }
    return result.cancelled
  }

  /**
   * Copy a closed native-sdk turn into a fresh Session without a model request.
   * @param sessionId - readable source Session under the initialized workspace.
   * @param destinationSessionId - fresh destination identity; existing identities reject.
   * @param atSeq - source event in a closed turn; omitted selects its last closed turn.
   * @returns the durable destination identity; unsupported profiles reject.
   */
  async fork(sessionId: string, destinationSessionId: string, atSeq?: number): Promise<string> {
    const result = await this.request('session/fork', { sessionId, destinationSessionId,
      ...atSeq === undefined ? {} : { atSeq } })
    if (!isRecord(result) || typeof result.sessionId !== 'string' || result.sessionId !== destinationSessionId) {
      throw new SdkProtocolError(`session/fork returned no matching Session identity: ${JSON.stringify(result)}`)
    }
    return result.sessionId
  }

  /**
   * Send one JSON-RPC request and await its result.
   * @param method - the wire method name.
   * @param params - the params object; omitted params send `{}`.
   * @param timeoutMs - per-call override of {@link HarnessClientOptions.requestTimeoutMs}.
   * @returns the raw result; rejects with {@link JsonRpcResponseError} on a
   * protocol error response, {@link RequestTimeoutError} on timeout, and
   * {@link TransportClosedError} when the runtime is gone.
   */
  async request(method: string, params?: object, timeoutMs?: number): Promise<unknown> {
    this.start()
    return this.requestOnStartedTransport(method, params, timeoutMs)
  }

  private async requestOnStartedTransport(method: string, params?: object, timeoutMs?: number): Promise<unknown> {
    // A dead runtime cannot answer; fail with process context instead of
    // writing into a destroyed pipe and hanging until the timeout.
    if (this.exitCode !== undefined || this.spawnError !== undefined || this.rangeError !== undefined) {
      await this.settleStreams()
      throw this.closedError('DeepSeek Harness runtime is not running')
    }
    const transport = this.transport
    /* v8 ignore next -- start() either sets the transport or throws */
    if (transport === undefined) throw new TransportClosedError('DeepSeek Harness runtime is not running')
    const timeout = timeoutMs ?? this.runtime.requestTimeoutMs
    try {
      if (timeout === undefined) return await transport.request(method, params ?? {})
      // The abort signal makes the timeout an abandonment: the transport drops
      // its pending entry, so repeated bounded requests against a hung method
      // retain no per-call state (the server-side work still runs to close).
      const abandon = new AbortController()
      const timer = setTimeout(() => {
        const stderr = this.stderrTail.length === 0 ? '' : `; stderr tail:\n${this.stderrTail.join('\n')}`
        abandon.abort(new RequestTimeoutError(`${method} timed out after ${timeout}ms waiting for ${this.runtime.description}${stderr}`))
      }, timeout)
      try {
        return await transport.request(method, params ?? {}, abandon.signal)
      } finally {
        clearTimeout(timer)
      }
    } catch (error) {
      if (error instanceof JsonRpcResponseError || error instanceof RequestTimeoutError) throw error
      // Transport-level failures gain process context: exit code + stderr tail.
      await this.settleStreams()
      throw this.closedError(errorMessage(error))
    }
  }

  /**
   * Subscribe to server notifications.
   * @param filter - optional predicate; omitted means every notification.
   * @returns the subscription handle; close it to stop delivery. After
   * {@link close} or runtime death the handle is born failed — there is no
   * producer left, so `next()` rejects instead of waiting forever.
   */
  subscribe(filter?: NotificationFilter): NotificationSubscription {
    const id = String(this.subscriptionSerial++)
    const state: SubscriptionState = { queue: [], waiters: [], filter, failure: undefined }
    const subscription = new NotificationSubscriptionImpl(state, () => { this.subscriptions.delete(id) })
    if (this.closeTask !== undefined || this.exitCode !== undefined || this.spawnError !== undefined || this.rangeError !== undefined) {
      subscription.fail(this.closedError('DeepSeek Harness runtime closed'))
      return subscription
    }
    this.subscriptions.set(id, subscription)
    return subscription
  }

  /**
   * Subscribe to one session and the descendants discovered from
   * `subagent.started` lineage edges. The runtime notifies for every session
   * in its context, so this client applies the scope.
   * @param sessionId - the root session id.
   * @returns the filtered subscription handle.
   */
  subscribeSessionTree(sessionId: string): NotificationSubscription {
    return this.subscribe((notification) => {
      const params = notification.params
      if (notification.method === 'subagent.started' || notification.method === 'subagent.finished') {
        const parentId = params.parentSessionId
        if (typeof parentId === 'string' && this.isDescendantOf(parentId, sessionId)) return true
        return params.childSessionId === sessionId
      }
      const relatedId = params.sessionId
      return typeof relatedId === 'string' && this.isDescendantOf(relatedId, sessionId)
    })
  }

  /**
   * Shut the runtime down and reap it: a best-effort protocol `shutdown`
   * and write flush, each bounded by `shutdownTimeoutMs`, then close stdin and
   * await the Provider-managed process range. Idempotent.
   * @returns settlement of the complete teardown.
   */
  close(): Promise<void> {
    this.closeTask ??= this.performClose()
    return this.closeTask
  }

  private async performClose(): Promise<void> {
    this.abortApprovalRequests(new TransportClosedError('SDK client is closing'))
    await Promise.allSettled([...this.approvalWork])
    const child = this.child
    const failures: unknown[] = []
    let flushError: Error | undefined
    let connectionReleased = child === undefined
    if (child !== undefined) {
      try {
        await this.requestOnStartedTransport('shutdown', undefined, this.runtime.shutdownTimeoutMs ?? 1_000)
      } catch (error) {
        // Diagnostic only: EOF and Provider termination remain authoritative.
        this.appendStderr([`shutdown request failed: ${errorMessage(error)}`])
      }
      const transport = this.transport
      if (transport !== undefined) {
        const flushTimeoutMs = this.runtime.shutdownTimeoutMs ?? 1_000
        let flushTimer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            transport.flush(),
            new Promise<never>((_, reject) => {
              flushTimer = setTimeout(() => { reject(new Error(`stdio flush timed out after ${flushTimeoutMs}ms`)) }, flushTimeoutMs)
            }),
          ])
        } catch (error) {
          flushError = error instanceof Error ? error : new Error(String(error))
          this.appendStderr([`stdio flush failed: ${errorMessage(flushError)}`])
        } finally {
          if (flushTimer !== undefined) clearTimeout(flushTimer)
        }
      }
      try {
        await disposeChildConnection(child, {
          eofGraceMs: this.runtime.disposeEofGraceMs ?? 6_000,
          terminationGraceMs: this.runtime.disposeGraceMs ?? 3_000,
        })
        await child.done.catch(() => {})
        await this.settleStreams()
        connectionReleased = true
      } catch (error) {
        failures.push(error)
      }
    }
    if (connectionReleased) {
      this.transport?.close()
      this.failSubscriptions(this.closedError('DeepSeek Harness runtime closed'))
      const provider = this.processProvider
      if (provider !== undefined) {
        try {
          await provider.dispose()
          this.processProvider = undefined
        } catch (error) {
          failures.push(error)
        }
      }
      const disposeRuntime = this.runtimeDisposer
      if (disposeRuntime !== undefined) {
        this.runtimeDisposer = undefined
        try { await disposeRuntime() }
        catch (error) { failures.push(error) }
      }
    }
    if (flushError !== undefined && failures.length > 0) failures.unshift(flushError)
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'runtime connection and process owner cleanup failed')
  }

  private async handleIncomingRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method !== 'approval/request') throw new SdkProtocolError('unsupported server request: ' + method)
    const request = approvalRequest(params)
    const relay = this.approvalRelay
    if (request === undefined || relay !== undefined && request.operationId !== relay.operationId) {
      throw new SdkProtocolError('approval/request does not match the active SDK operation')
    }
    if (this.closeTask !== undefined) {
      return { operationId: request.operationId, requestId: request.requestId, outcome: 'cancelled' }
    }
    const key = approvalKey(request.operationId, request.requestId)
    if (this.seenApprovalRequests.has(key)) {
      return { operationId: request.operationId, requestId: request.requestId, outcome: 'unavailable' }
    }
    this.seenApprovalRequests.add(key)
    const controller = new AbortController()
    this.activeApprovalRequests.set(key, controller)
    const cancelled = Promise.withResolvers<NativeSdkChildApprovalOutcome>()
    const onAbort = (): void => { cancelled.resolve('cancelled') }
    controller.signal.addEventListener('abort', onAbort, { once: true })
    if (controller.signal.aborted) onAbort()
    const work: Promise<NativeSdkChildApprovalOutcome> = Promise.resolve()
      .then((): Promise<NativeSdkChildApprovalOutcome> | NativeSdkChildApprovalOutcome => {
        if (relay !== undefined) return relay.request(request, controller.signal)
        return this.options.onApprovalRequest?.(request, controller.signal) ?? 'unavailable'
      })
      .then((outcome: unknown): NativeSdkChildApprovalOutcome => isApprovalOutcome(outcome) ? outcome : 'unavailable',
        (): NativeSdkChildApprovalOutcome => 'unavailable')
    const task = Promise.race([work, cancelled.promise])
    this.approvalWork.add(task)
    void task.then(() => { this.approvalWork.delete(task) })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = this.runtime.requestTimeoutMs
      const outcome = timeout === undefined ? await task : await Promise.race([
        task,
        new Promise<NativeSdkChildApprovalOutcome>((resolveOutcome) => {
          timer = setTimeout(() => {
            controller.abort(new RequestTimeoutError('approval/request timed out after ' + timeout + 'ms'))
            resolveOutcome('cancelled')
          }, timeout)
        }),
      ])
      return {
        operationId: request.operationId,
        requestId: request.requestId,
        outcome: controller.signal.aborted ? 'cancelled' : outcome,
      } satisfies ApprovalRequestResult
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      controller.signal.removeEventListener('abort', onAbort)
      this.activeApprovalRequests.delete(key)
    }
  }
  private cancelApproval(params: Record<string, unknown>): void {
    if (typeof params.operationId !== 'string' || typeof params.requestId !== 'string') return
    this.activeApprovalRequests.get(approvalKey(params.operationId, params.requestId))
      ?.abort(new Error('parent approval request was cancelled'))
  }

  private abortApprovalRequests(reason: Error): void {
    for (const controller of this.activeApprovalRequests.values()) controller.abort(reason)
  }

  private dispatchNotification(notification: HarnessNotification): void {
    this.recordSessionRelationship(notification)
    for (const subscription of this.subscriptions.values()) subscription.push(notification)
  }

  private recordSessionRelationship(notification: HarnessNotification): void {
    if (notification.method !== 'subagent.started') return
    const parentId = notification.params.parentSessionId
    const childId = notification.params.childSessionId
    if (typeof parentId === 'string' && parentId !== '' && typeof childId === 'string' && childId !== '' && parentId !== childId) {
      this.sessionParents.set(childId, parentId)
    }
  }

  private isDescendantOf(sessionId: string, rootSessionId: string): boolean {
    const visited = new Set<string>()
    let current = sessionId
    while (!visited.has(current)) {
      if (current === rootSessionId) return true
      visited.add(current)
      const parent = this.sessionParents.get(current)
      if (parent === undefined) return false
      current = parent
    }
    // The parent map only ever extends chains upward, so a cycle cannot form.
    /* v8 ignore next */
    return false
  }

  private failSubscriptions(error: Error): void {
    for (const subscription of this.subscriptions.values()) subscription.fail(error)
  }

  private appendStderr(lines: string[]): void {
    const kept = lines.filter(line => line.length > 0)
    this.stderrTail.push(...kept)
    if (this.stderrTail.length > STDERR_TAIL_LIMIT) {
      this.stderrTail.splice(0, this.stderrTail.length - STDERR_TAIL_LIMIT)
    }
  }

  private settleStreams(): Promise<void> {
    return Promise.race([
      this.streamsSettled,
      new Promise<void>((resolve) => { setTimeout(resolve, STREAM_SETTLE_MS) }),
    ])
  }

  private closedError(reason: string): TransportClosedError {
    const parts = [`${this.runtime.description}: ${reason}`]
    if (this.spawnError !== undefined) parts.push(`spawn error: ${this.spawnError.message}`)
    if (this.rangeError !== undefined) parts.push(`managed-range error: ${this.rangeError.message}`)
    if (this.exitCode !== undefined) parts.push(`exit code: ${String(this.exitCode)}`)
    if (this.stderrTail.length > 0) parts.push(`stderr tail:\n${this.stderrTail.join('\n')}`)
    return new TransportClosedError(parts.join('\n'))
  }
}

/**
 * Construct the transport against a generic process for package-local fake-runtime tests.
 * @param options - process launch settings for the fake or real runtime.
 * @returns a client bound to the supplied runtime process.
 */
export function createProcessHarnessClient(options: RuntimeProcessOptions): HarnessClient {
  const Constructor = HarnessClient as unknown as new (
    publicOptions: HarnessClientOptions,
    runtime: RuntimeProcessOptions,
  ) => HarnessClient
  return new Constructor({}, options)
}

/**
 * Construct the standard dsh launcher client with a Native Host-owned connection.
 * This helper stays off the generic package export; only `./native` exposes the
 * fixed-profile high-level constructor.
 * @param options - standard SDK launch settings without a runtime override.
 * @param childConnection - Host-owned managed stdio connection capability.
 * @param runtime - Program-resolved fixed runtime settings.
 * @param dispose - optional disposer for the Host-owned runtime resources.
 * @param approvalRelay - optional parent-owned relay for Native approval requests.
 * @returns the low-level client bound to that connection.
 */
export function createNativeHarnessClient(
  options: HarnessClientOptions,
  childConnection: ChildConnectionDefinition,
  runtime: RuntimeProcessOptions,
  dispose?: () => Promise<void>,
  approvalRelay?: NativeSdkChildApprovalRelay,
): HarnessClient {
  return new HarnessClient({ ...options, [nativeChildConnection]: { definition: childConnection, dispose },
    ...approvalRelay === undefined ? {} : { [nativeApprovalRelay]: approvalRelay } } as HarnessClientOptions, runtime)
}

/**
 * Whether `value` is a plain JSON object (the wire-boundary shape probe).
 * @param value - the wire value to probe.
 * @returns `true` iff `value` is a non-null, non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function approvalRequest(value: unknown): ApprovalRequestParams | undefined {
  if (!isRecord(value) || typeof value.operationId !== 'string' || value.operationId.length === 0
    || typeof value.requestId !== 'string' || value.requestId.length === 0
    || typeof value.sessionId !== 'string' || value.sessionId.length === 0
    || value.toolName !== 'write_file' || typeof value.callId !== 'string' || value.callId.length === 0
    || value.reason !== undefined && typeof value.reason !== 'string') return undefined
  return {
    operationId: value.operationId, requestId: value.requestId, sessionId: value.sessionId,
    toolName: 'write_file', callId: value.callId,
    ...(value.reason === undefined ? {} : { reason: value.reason }),
  }
}

function isApprovalOutcome(value: unknown): value is NativeSdkChildApprovalOutcome {
  return value === 'allowed-once' || value === 'rejected' || value === 'cancelled' || value === 'unavailable'
}

function approvalKey(operationId: string, requestId: string): string {
  return `${operationId}\\0${requestId}`
}

/** The message of a thrown value (the transport only throws `Error`s; `String` covers the rest). */
function errorMessage(error: unknown): string {
  /* v8 ignore next -- the transport and dispose ladder reject only with Errors */
  return error instanceof Error ? error.message : String(error)
}
