/** Browser Session Consumer over the selected native Connection transport. */
import { nativeWebHumanSchema, type NativeWebHumanAnswer, type NativeWebHumanId, type NativeWebHumanPrompt } from './human.ts'
export type { NativeWebHumanAnswer, NativeWebHumanId, NativeWebHumanPrompt } from './human.ts'
import { EventSourceParserStream } from 'eventsource-parser/stream'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-client-connection/native'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/native'
import type { SessionId, SessionHeader, SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session/types'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/types'
import { parseSessionEvent } from '@deepseek-ai/dsh-session/event-validation'
import { nativeModelControlsSchema, type NativeModelControls } from './model-controls.ts'
import type { NativeModelSelectionRequest } from '@deepseek-ai/dsh-native-model-selection/types'
import type { NativeAgentPresetSelectionRequest } from '@deepseek-ai/dsh-agent-presets/selection'
export type { NativeModelControls } from './model-controls.ts'

type NativeSessionAdmissionId = Branded<'native-web-admission'>

/** Raster upload bytes encoded by the browser; the Host admits their durable references. */
export interface NativeImageUpload {
  readonly mediaType: NativeSessionImage['mediaType']
  readonly data: string
  readonly name?: string
}

/** Original durable image identity from the Session message protocol. */
export type NativeSessionImage = Extract<SessionEventMap['user/message']['content'][number], { type: 'image' }>['attachment']

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** Native Session RPC Consumer selected by the browser composition. */
    clientNativeSession: NativeSessionClient
  }
}

import type { NativeSessionFollowFrame } from './follow-types.ts'
export type { NativeSessionFollowFrame } from './follow-types.ts'

/** Browser parser capacity, resolved by the native Client profile. */
export interface NativeSessionClientConfig {
  readonly maxFollowBufferChars: number
}

/** Redacted Settings registration returned by the native Host configuration RPC. */
export interface NativeSettingsDescriptor {
  /** Owning Settings namespace. */
  readonly namespace: string
  /** Serialized owner schema. */
  readonly schema: unknown
  /** Resolved values with schema-declared secret paths omitted. */
  readonly value: Readonly<Record<string, unknown>>
  /** Redacted composition base. */
  readonly base: Readonly<Record<string, unknown>>
  /** Redacted stored user overrides. */
  readonly user: Readonly<Record<string, unknown>>
  /** Owner-declared effect timing. */
  readonly applies: 'live' | 'restart'
  /** Hidden secret locations and their current presence. */
  readonly secrets: readonly { readonly path: readonly string[]; readonly set: boolean }[]
  /** Current values carrying the `credential-ref` schema role. */
  readonly credentialRefs: readonly string[]
  /** Revision expected by the next write. */
  readonly revision: number
}

/** One path-addressed Settings edit. */
export type NativeSettingsPathOp =
  /** Set one JSON value at the path. */
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  /** Remove the path from the user layer. */
  | { readonly op: 'unset'; readonly path: readonly string[] }

/** Safe credential presence facts; the credential value is never returned. */
export interface NativeCredentialInfo {
  /** Whether a credential provider resolves a value for this ref. */
  readonly configured: boolean
  /** Provider source label, when configured. */
  readonly source?: string
  /** Whether the current provider accepts writes. */
  readonly writable: boolean
}

/** Structured rejection from one native Host RPC endpoint. */
export class NativeSessionRpcError extends Error {
  /** @param code - stable native RPC failure code.
   * @param message - Host refusal message.
   * @param details - safe, endpoint-specific failure facts.
   */
  constructor(readonly code: string, message: string, readonly details: object) {
    super(message)
    this.name = 'NativeSessionRpcError'
  }
}

/** Lifecycle results shared by the native browser composition. */
export interface NativeSessionClient {
  /** Describe schema-published Settings namespaces with redacted values.
   * @param signal - caller cancellation.
   * @returns the currently registered native Settings views.
   */
  settingsDescribe(signal?: AbortSignal): Promise<readonly NativeSettingsDescriptor[]>
  /** Apply Settings path edits against the revision the page displayed.
   * @param namespace - registered Settings namespace.
   * @param ops - path-addressed user-layer edits.
   * @param expectedRevision - observed revision; stale writes reject with `native/settings-conflict`.
   * @param signal - caller cancellation.
   * @returns the actual redacted view after the write.
   */
  settingsMutate(
    namespace: string, ops: readonly NativeSettingsPathOp[], expectedRevision: number, signal?: AbortSignal,
  ): Promise<NativeSettingsDescriptor>
  /** Describe credential refs declared by the active Settings schemas.
   * @param refs - schema-discovered reference names.
   * @param signal - caller cancellation.
   * @returns presence and source facts without values.
   */
  credentialsDescribe(refs: readonly string[], signal?: AbortSignal): Promise<Readonly<Record<string, NativeCredentialInfo>>>
  /** Store one secret value for a schema-declared credential reference.
   * @param ref - discovered credential reference.
   * @param value - write-only credential value.
   * @param signal - caller cancellation.
   * @returns completion acknowledgement.
   */
  credentialsSet(ref: string, value: string, signal?: AbortSignal): Promise<void>
  /** Remove one schema-declared credential reference.
   * @param ref - discovered credential reference.
   * @param signal - caller cancellation.
   * @returns completion acknowledgement.
   */
  credentialsUnset(ref: string, signal?: AbortSignal): Promise<void>
  /** Fetch verified bytes of an image recorded in the selected Session.
   * @param sessionId - recorded Session identity.
   * @param image - image reference obtained from its validated history.
   * @param signal - caller cancellation.
   * @returns verified raster Blob, suitable for an owned object URL.
   */
  image(sessionId: SessionId, image: NativeSessionImage, signal?: AbortSignal): Promise<Blob>
  /** Answer a presentation belonging to this Consumer's exact outstanding turn.
   * @param sessionId - selected Session.
   * @param id - observed pending presentation identity.
   * @param answer - structured allow/reject or question answers.
   * @param signal - caller cancellation.
   * @returns completion after the Host accepts the exact pending answer.
   */
  answerHuman(sessionId: SessionId, id: NativeWebHumanId, answer: NativeWebHumanAnswer, signal?: AbortSignal): Promise<void>
  /** Read actual advisory catalogs and installed standing presets.
   * @param signal - caller cancellation.
   * @returns current Host capability availability and provider-owned choices.
   */
  modelControls(signal?: AbortSignal): Promise<NativeModelControls>
  /** Persist a Session-local model/effort intent against its last observed revision.
   * @param sessionId - selected stored Session.
   * @param request - complete model choice and expected durable intent revision.
   * @param signal - caller cancellation.
   * @returns completion after the sole Host writer persists the choice.
   */
  selectModel(sessionId: SessionId, request: NativeModelSelectionRequest, signal?: AbortSignal): Promise<void>
  /** Replace the composition of an idle blank Session through its Program epoch.
   * @param request - Session, advertised preset and expected durable selection revision.
   * @param signal - caller cancellation.
   * @returns completion after old Agent drain and accepted successor activation.
   */
  selectPreset(request: NativeAgentPresetSelectionRequest, signal?: AbortSignal): Promise<void>
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
   * @param observe - synchronous presentation observer; failures cancel and drain the turn.
   * @param images - ordered browser uploads, admitted by the Host before the user message.
   * @returns durable turn settlement.
   */
  prompt(sessionId: SessionId, text: string, resume: boolean, signal?: AbortSignal,
    observe?: (frame: NativeSessionFollowFrame) => void, images?: readonly NativeImageUpload[]): Promise<{
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

function settingsDescriptor(value: unknown): NativeSettingsDescriptor {
  const data = fields(value)
  if (typeof data.namespace !== 'string' || data.namespace.length === 0 || typeof data.schema !== 'object' || data.schema === null
    || typeof data.value !== 'object' || data.value === null || Array.isArray(data.value)
    || typeof data.base !== 'object' || data.base === null || Array.isArray(data.base)
    || typeof data.user !== 'object' || data.user === null || Array.isArray(data.user)
    || data.applies !== 'live' && data.applies !== 'restart'
    || !Array.isArray(data.secrets) || !data.secrets.every((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false
    const secret = item as Record<string, unknown>
    return Array.isArray(secret.path) && secret.path.every(part => typeof part === 'string') && typeof secret.set === 'boolean'
  })
    || !Array.isArray(data.credentialRefs) || !data.credentialRefs.every(ref => typeof ref === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(ref))
    || typeof data.revision !== 'number' || !Number.isSafeInteger(data.revision) || data.revision < 0) {
    throw new TypeError('invalid native Settings descriptor')
  }
  return data as unknown as NativeSettingsDescriptor
}

function credentialInfo(value: unknown): NativeCredentialInfo {
  const data = fields(value)
  if (typeof data.configured !== 'boolean' || typeof data.writable !== 'boolean'
    || data.source !== undefined && typeof data.source !== 'string'
    || Object.keys(data).some(key => !['configured', 'writable', 'source'].includes(key))) {
    throw new TypeError('invalid native credential description')
  }
  return { configured: data.configured, writable: data.writable,
    ...data.source === undefined ? {} : { source: data.source as string } }
}

function header(value: unknown): SessionHeader {
  const data = fields(value)
  if (typeof data.id !== 'string' || data.id.length === 0 || data.version !== SESSION_FORMAT_VERSION
    || typeof data.createdAt !== 'number' || !Number.isSafeInteger(data.createdAt) || data.createdAt < 0
    || typeof data.isSeeded !== 'boolean') throw new TypeError('invalid native Session header')
  return data as unknown as SessionHeader
}

function decodeReply(endpoint: string, value: unknown): unknown {
  if (endpoint === 'settings/describe') {
    if (!Array.isArray(value)) throw new TypeError('native Settings description must be an array')
    return value.map(settingsDescriptor)
  }
  if (endpoint === 'settings/mutate') return settingsDescriptor(value)
  if (endpoint === 'credentials/describe') {
    const data = fields(value)
    return Object.fromEntries(Object.entries(data).map(([ref, info]) => [ref, credentialInfo(info)]))
  }
  if (endpoint === 'credentials/set' || endpoint === 'credentials/unset') {
    if (fields(value).updated !== true) throw new TypeError('invalid native credential write acknowledgement')
    return undefined
  }
  if (endpoint === 'session/model-controls') return nativeModelControlsSchema.parse(value)
  if (endpoint === 'session/list') {
    if (!Array.isArray(value)) throw new TypeError('native Session list must be an array')
    return value.map(header)
  }
  const data = fields(value)
  switch (endpoint) {
    case 'session/answer-human':
      if (data.answered !== true) throw new TypeError('invalid native human answer acknowledgement')
      break
    case 'session/select-model':
    case 'session/select-preset':
      if (data.changed !== true) throw new TypeError('invalid native Session selection acknowledgement')
      break
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

function followFrame(value: unknown): NativeSessionFollowFrame {
  const data = fields(value)
  if (data.type === 'human' && Object.keys(data).length === 2) return { type: 'human', prompt: nativeWebHumanSchema.parse(data.prompt) as NativeWebHumanPrompt }
  if (data.type === 'human-removed' && typeof data.id === 'string' && data.id.length > 0 && Object.keys(data).length === 2) return { type: 'human-removed', id: data.id as NativeWebHumanId }
  if (data.type === 'event' && Object.keys(data).length === 2) {
    const event = fields(data.event)
    if (typeof event.seq !== 'number') throw new TypeError('native Session follow: event has no sequence')
    return { type: 'event', event: parseSessionEvent(event, event.seq) }
  }
  if (data.type === 'text' && typeof data.text === 'string' && Object.keys(data).length === 2) return { type: 'text', text: data.text }
  if ((data.type === 'text-start' || data.type === 'settled') && Object.keys(data).length === 1) return { type: data.type }
  throw new TypeError('native Session follow: invalid frame')
}

function objectConfig(input: unknown): Record<string, unknown> {
  const data = fields(input)
  if (Object.keys(data).some(key => key !== 'maxFollowBufferChars') || typeof data.maxFollowBufferChars !== 'number'
    || !Number.isSafeInteger(data.maxFollowBufferChars) || data.maxFollowBufferChars < 1) throw new TypeError('native Session Client: invalid follow parser capacity')
  return data
}

/** Create a lifecycle Consumer without another transport or Session cache.
 * @param rpc - selected Connection's generic RPC caller.
 * @param config - explicit SSE parser capacity.
 * @param installationSignal - optional installation cancellation.
 * @returns typed Session operations; Host failures reject the call.
 */
export function createNativeSessionClient(
  rpc: ClientConnectionRpc, config: NativeSessionClientConfig, installationSignal?: AbortSignal,
): NativeSessionClient {
  const admissions = new Map<SessionId, NativeSessionAdmissionId>()
  const shutdown = new AbortController()
  const lifetime = installationSignal === undefined ? shutdown.signal : AbortSignal.any([installationSignal, shutdown.signal])
  const pendingPrompts = new Set<Promise<unknown>>()
  async function call<T>(endpoint: string, payload: object, signal?: AbortSignal, useLifetime = true): Promise<T> {
    const accepted = !useLifetime ? signal : signal === undefined ? lifetime : AbortSignal.any([lifetime, signal])
    const result = await rpc.call('/api', endpoint, payload, accepted)
    if (!result.ok) throw new NativeSessionRpcError(result.error.code, result.error.message, result.error.details)
    return decodeReply(endpoint, result.value) as T
  }
  async function prompt(
    sessionId: SessionId, text: string, resume: boolean, signal?: AbortSignal, observe?: (frame: NativeSessionFollowFrame) => void,
    images?: readonly NativeImageUpload[],
  ) {
    const accepted = signal === undefined ? lifetime : AbortSignal.any([lifetime, signal])
    accepted.throwIfAborted()
    const responseOperation = rpc.response
    if (observe !== undefined && responseOperation === undefined) throw new Error('native Session Client: selected carrier has no Fetch response operation')
    const following = new AbortController()
    // Admission and settlement remain reachable while caller cancellation requests exact Host drain.
    const { admissionId } = await call<{ admissionId: NativeSessionAdmissionId }>('session/start', { sessionId, text, resume, follow: observe !== undefined,
      ...images === undefined ? {} : { images } }, undefined, false)
    admissions.set(sessionId, admissionId)
    let cancellation: Promise<unknown> | undefined
    const abort = (): void => {
      following.abort(accepted.reason)
      cancellation ??= call('session/cancel', { sessionId, admissionId }, undefined, false)
      // Settlement reports cancellation failures after the original turn's response has drained.
      void cancellation.then(() => undefined, () => undefined)
    }
    accepted.addEventListener('abort', abort, { once: true })
    if (accepted.aborted) abort()
    try {
      let followFailure: { error: unknown } | undefined
      if (observe !== undefined && responseOperation !== undefined) {
        try {
          const response = await responseOperation('/api', 'native-session/follow', { sessionId, admissionId }, following.signal)
          if (!response.ok || response.body === null || response.headers.get('content-type') !== 'text/event-stream') {
            throw new Error(`native Session follow: invalid response HTTP ${response.status}`)
          }
          let terminal = false
          const events = response.body.pipeThrough(new TextDecoderStream())
            .pipeThrough(new EventSourceParserStream({ maxBufferSize: config.maxFollowBufferChars, onError: 'terminate' }))
          let nextSeq: number | undefined
          for await (const { data } of events) {
            const frame = followFrame(JSON.parse(data))
            if (terminal) throw new Error('native Session follow: output after settlement')
            if (frame.type === 'event') {
              if (nextSeq !== undefined && frame.event.seq !== nextSeq) throw new Error('native Session follow: event sequence gap')
              nextSeq = frame.event.seq + 1
            }
            if (frame.type === 'settled') terminal = true
            observe(frame)
          }
          if (!terminal) throw new Error('native Session follow: EOF before settlement')
        } catch (error: unknown) {
          if (!accepted.aborted) { followFailure = { error }; abort() }
        }
      }
      const [settlement] = await Promise.allSettled([call<{ exitCode: number; answer?: string }>('session/await', { sessionId, admissionId }, undefined, false)])
      const controls = await Promise.allSettled(cancellation === undefined ? [] : [cancellation])
      const errors = [settlement, ...controls].flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : [])
      if (followFailure !== undefined) errors.unshift(followFailure.error)
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, 'native Session settlement and cancellation failed')
      if (settlement.status === 'rejected') throw settlement.reason
      return settlement.value
    } finally { if (admissions.get(sessionId) === admissionId) admissions.delete(sessionId); accepted.removeEventListener('abort', abort) }
  }
  return {
    settingsDescribe: signal => call('settings/describe', {}, signal),
    settingsMutate: (namespace, ops, expectedRevision, signal) =>
      call('settings/mutate', { ns: namespace, ops, expectedRevision }, signal),
    credentialsDescribe: (refs, signal) => call('credentials/describe', { refs }, signal),
    async credentialsSet(ref, value, signal) { await call('credentials/set', { ref, value }, signal) },
    async credentialsUnset(ref, signal) { await call('credentials/unset', { ref }, signal) },
    async image(sessionId, image, signal) {
      const accepted = signal === undefined ? lifetime : AbortSignal.any([lifetime, signal])
      accepted.throwIfAborted()
      if (rpc.response === undefined) throw new Error('native Session Client: selected carrier has no Fetch response operation')
      const response = await rpc.response('/api', 'native-session/image', { sessionId, attachmentId: image.attachmentId }, accepted)
      if (!response.ok || response.headers.get('content-type') !== image.mediaType
        || response.headers.get('content-length') !== String(image.bytes)) throw new Error(`native Session image: invalid response HTTP ${response.status}`)
      const blob = await response.blob()
      accepted.throwIfAborted()
      if (blob.size !== image.bytes) throw new Error('native Session image: byte length mismatch')
      return blob
    },
    async close() {
      shutdown.abort(new Error('native Session Client disposed'))
      await Promise.allSettled([...pendingPrompts])
    },
    async answerHuman(sessionId, id, answer, signal) {
      const admissionId = admissions.get(sessionId)
      if (admissionId === undefined) throw new Error('native Session Client: human answer has no owned turn')
      await call('session/answer-human', { sessionId, admissionId, id, answer }, signal)
    },
    list: signal => call('session/list', {}, signal),
    modelControls: signal => call('session/model-controls', {}, signal),
    async selectModel(sessionId, request, signal) {
      await call('session/select-model', { sessionId, ...request }, signal)
    },
    async selectPreset({ id, ...request }, signal) {
      await call('session/select-preset', { sessionId: id, ...request }, signal)
    },
    create: signal => call('session/create', {}, signal),
    history: (sessionId, signal) => call('session/history', { sessionId }, signal),
    prompt(sessionId, text, resume, signal, observe, images) {
      const pending = prompt(sessionId, text, resume, signal, observe, images)
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
    const fields = objectConfig(input)
    const config: NativeSessionClientConfig = { maxFollowBufferChars: fields.maxFollowBufferChars as number }
    return (context) => {
      const client = createNativeSessionClient(context.require('clientConnection').rpc, config, context.signal)
      context.own(() => client.close())
      context.provide('clientNativeSession', client)
    }
  },
}
