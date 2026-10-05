/** Browser Session Consumer over the selected native Connection transport. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-client-connection/native'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/native'
import type { SessionId, SessionHeader, SessionEvent } from '@deepseek-ai/dsh-session/types'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/types'
import { parseSessionEvent } from '@deepseek-ai/dsh-session/event-validation'

type NativeSessionAdmissionId = Branded<'native-web-admission'>

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** Native Session RPC Consumer selected by the browser composition. */
    clientNativeSession: NativeSessionClient
  }
}

/** Lifecycle results shared by the native browser composition. */
export interface NativeSessionClient {
  /** Cancel owned prompts and wait for their Host settlement replies.
   * @returns completion after all owned calls settle.
   */
  close(): Promise<void>
  /**
   * @param signal - caller cancellation.
   * @returns stored Session headers.
   */
  list(signal?: AbortSignal): Promise<readonly SessionHeader[]>
  /**
   * @param signal - caller cancellation.
   * @returns a durably created blank Session.
   */
  create(signal?: AbortSignal): Promise<{ readonly sessionId: SessionId }>
  /**
   * @param sessionId - stored identity.
   * @param signal - caller cancellation.
   * @returns bounded durable history.
   */
  history(sessionId: SessionId, signal?: AbortSignal): Promise<{
    readonly header: SessionHeader
    readonly events: readonly SessionEvent[]
    readonly inheritedEventCount: number
  }>
  /**
   * @param sessionId - selected identity.
   * @param text - human input.
   * @param resume - explicit existing-Session selection.
   * @param signal - abort cancels and drains this turn.
   * @returns durable turn settlement.
   */
  prompt(sessionId: SessionId, text: string, resume: boolean, signal?: AbortSignal): Promise<{
    readonly exitCode: number
    readonly answer?: string
  }>
  /**
   * @param sessionId - selected identity.
   * @param signal - caller cancellation.
   * @returns cancellation after turn settlement.
   */
  cancel(sessionId: SessionId, signal?: AbortSignal): Promise<{ readonly cancelled: boolean }>
  /**
   * @param sessionId - selected identity.
   * @param signal - caller cancellation.
   * @returns current Program admission state.
   */
  status(sessionId: SessionId, signal?: AbortSignal): Promise<{ readonly status: 'running' | 'idle' | 'unknown' }>
}

function fields(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('native Session reply must be an object')
  return value as Record<string, unknown>
}

function header(value: unknown): SessionHeader {
  const data = fields(value)
  if (typeof data.id !== 'string' || data.id.length === 0 || data.version !== SESSION_FORMAT_VERSION
    || typeof data.createdAt !== 'number' || !Number.isSafeInteger(data.createdAt) || data.createdAt < 0
    || typeof data.isSeeded !== 'boolean') throw new TypeError('invalid native Session header')
  return data as unknown as SessionHeader
}

function decodeReply(endpoint: string, value: unknown): unknown {
  if (endpoint === 'session/list') {
    if (!Array.isArray(value)) throw new TypeError('native Session list must be an array')
    return value.map(header)
  }
  const data = fields(value)
  switch (endpoint) {
    case 'session/history':
      if (!Array.isArray(data.events) || typeof data.inheritedEventCount !== 'number'
        || !Number.isSafeInteger(data.inheritedEventCount) || data.inheritedEventCount < 0
        || data.inheritedEventCount > data.events.length) throw new TypeError('invalid native Session history')
      return { header: header(data.header), inheritedEventCount: data.inheritedEventCount,
        events: data.events.map((value: unknown, index: number) => parseSessionEvent(value, index)) }
    case 'session/start':
      if (typeof data.admissionId !== 'string' || data.admissionId.length === 0) throw new TypeError('invalid native Session admission')
      break
    case 'session/create':
      if (typeof data.sessionId !== 'string' || data.sessionId.length === 0) throw new TypeError('invalid native Session identity')
      break
    case 'session/prompt':
    case 'session/await':
      if (typeof data.exitCode !== 'number' || !Number.isSafeInteger(data.exitCode)
        || data.answer !== undefined && typeof data.answer !== 'string') throw new TypeError('invalid native Session result')
      break
    case 'session/cancel':
      if (typeof data.cancelled !== 'boolean') throw new TypeError('invalid native Session cancellation')
      break
    case 'session/status':
      if (data.status !== 'idle' && data.status !== 'running' && data.status !== 'unknown') throw new TypeError('invalid native Session status')
      break
    default: throw new Error('unsupported native Session reply')
  }
  return data
}

/** Create a lifecycle Consumer without another transport or Session cache.
 * @param rpc - selected Connection's generic RPC caller.
 * @param installationSignal - optional installation cancellation.
 * @returns typed Session operations; Host failures reject the call.
 */
export function createNativeSessionClient(rpc: ClientConnectionRpc, installationSignal?: AbortSignal): NativeSessionClient {
  const shutdown = new AbortController()
  const lifetime = installationSignal === undefined ? shutdown.signal : AbortSignal.any([installationSignal, shutdown.signal])
  const pendingPrompts = new Set<Promise<unknown>>()
  async function call<T>(endpoint: string, payload: object, signal?: AbortSignal, useLifetime = true): Promise<T> {
    const accepted = !useLifetime ? signal : signal === undefined ? lifetime : AbortSignal.any([lifetime, signal])
    const result = await rpc.call('/api', endpoint, payload, accepted)
    if (!result.ok) throw new Error(result.error.message)
    return decodeReply(endpoint, result.value) as T
  }
  async function prompt(sessionId: SessionId, text: string, resume: boolean, signal?: AbortSignal) {
    const accepted = signal === undefined ? lifetime : AbortSignal.any([lifetime, signal])
    accepted.throwIfAborted()
    // Admission and settlement remain reachable while caller cancellation requests exact Host drain.
    const { admissionId } = await call<{ admissionId: NativeSessionAdmissionId }>('session/start', { sessionId, text, resume }, undefined, false)
    let cancellation: Promise<unknown> | undefined
    const abort = (): void => {
      cancellation ??= call('session/cancel', { sessionId, admissionId }, undefined, false)
      // Settlement reports cancellation failures after the original turn's response has drained.
      void cancellation.then(() => undefined, () => undefined)
    }
    accepted.addEventListener('abort', abort, { once: true })
    if (accepted.aborted) abort()
    try {
      const [settlement] = await Promise.allSettled([call<{ exitCode: number; answer?: string }>('session/await', { sessionId, admissionId }, undefined, false)])
      const controls = await Promise.allSettled(cancellation === undefined ? [] : [cancellation])
      const errors = [settlement, ...controls].flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : [])
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, 'native Session settlement and cancellation failed')
      if (settlement.status === 'rejected') throw settlement.reason
      return settlement.value
    } finally { accepted.removeEventListener('abort', abort) }
  }
  return {
    async close() {
      shutdown.abort(new Error('native Session Client disposed'))
      await Promise.allSettled([...pendingPrompts])
    },
    list: signal => call('session/list', {}, signal),
    create: signal => call('session/create', {}, signal),
    history: (sessionId, signal) => call('session/history', { sessionId }, signal),
    prompt(sessionId, text, resume, signal) {
      const pending = prompt(sessionId, text, resume, signal)
      pendingPrompts.add(pending)
      const settled = (): void => { pendingPrompts.delete(pending) }
      void pending.then(settled, settled)
      return pending
    },
    cancel: (sessionId, signal) => call('session/cancel', { sessionId }, signal),
    status: (sessionId, signal) => call('session/status', { sessionId }, signal),
  }
}

/** Native browser installation that shares the Connection Provider's owned transport. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-client-native-session', targets: ['client'],
  requires: ['clientConnection'], provides: ['clientNativeSession'],
  resolve(input) {
    if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 0)) {
      throw new TypeError('client native session: configuration must be empty')
    }
    return (context) => {
      const client = createNativeSessionClient(context.require('clientConnection').rpc, context.signal)
      context.own(() => client.close())
      context.provide('clientNativeSession', client)
    }
  },
}
