/** Browser-safe current Session event admission and identified-message validation. */
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { Message } from '@deepseek-ai/dsh-llm/native'
import type { SessionEvent, SurfaceEventType } from './types.ts'
import { validateSessionEventData, validateSurfaceMetadata } from './surface.ts'
import { KNOWN_SESSION_EVENT_TYPES } from './known-event-types.ts'

/**
 * Validate an exclusively owned event and deeply freeze its identified message
 * without copying the event. The caller transfers an object graph that no
 * producer retains and that shares no mutable children with another event.
 * Use {@link snapshotSessionEvent} when exclusive ownership is not guaranteed.
 * @param event - exclusively owned event imported across a trusted boundary.
 * @returns the same event object with a validated, deeply frozen message.
 * @throws when event-local surface metadata, request-header fields, or message invariants are invalid; history relations are not checked.
 */
export function adoptSessionEvent<T extends SessionEvent>(event: T): T {
  validateSessionEventData(event, `session event at seq ${event.seq}`)
  validateSurfaceMetadata(event)
  assertMessageEventShape(
    event,
    `session event at seq ${event.seq}`,
  )
  switch (event.type) {
    case 'user/message':
      deepFreeze(event.data)
      break
    case 'system/message':
    case 'assistant/message':
    case 'tool/result':
      deepFreeze(event.data.message)
      break
    default:
      // SessionEventMap is merge-extensible; plugin-owned events carry no core message.
      break
  }
  return event
}

/**
 * Detach one event while preserving deep immutability for its identified message.
 * @param event - event imported across a query or persistence boundary.
 * @returns a detached event snapshot with a validated, deeply frozen message.
 */
export function snapshotSessionEvent<T extends SessionEvent>(event: T): T {
  return adoptSessionEvent(structuredClone(event))
}

/** Validate the fixed event envelope after one-pass JSON materialization.
 * @param value - decoded event.
 * @param index - expected event position.
 * @returns narrows the decoded event after validation.
 */
export function assertSessionEventEnvelope(value: unknown, index: number): asserts value is SessionEvent {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`seed event at index ${index} has an invalid event envelope`)
  }
  const event = value as Record<string, unknown>
  for (const key in event) {
    switch (key) {
      case 'type':
      case 'seq':
      case 'time':
      case 'data':
      case 'surfaceOp':
      case 'sourceEventSeqs':
      case 'ignorable':
        break
      default:
        throw new Error(`seed event at index ${index} has an invalid event envelope`)
    }
  }
  const type = event['type']
  const seq = event['seq']
  const time = event['time']
  if (typeof type !== 'string'
    || typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0 || Object.is(seq, -0)
    || typeof time !== 'number' || !Number.isSafeInteger(time)
    || event['data'] === undefined
    || (event['ignorable'] !== undefined && event['ignorable'] !== true)) {
    throw new Error(`seed event at index ${index} has an invalid event envelope`)
  }
  validateSessionEventData(event as SessionEvent, `seed ${type} at index ${index}`)
  switch (type) {
    case 'request/header':
    case 'system/message':
    case 'user/message':
    case 'assistant/attempt':
    case 'assistant/message':
    case 'tool/result':
      assertCurrentLlmShape(event, index)
      break
  }
}

/** Reject obsolete request headers and malformed messages at the seed/load boundary. */
function assertCurrentLlmShape(event: Record<string, unknown>, index: number): void {
  const data = event['data']
  const record = typeof data === 'object' && data !== null
    ? data as Record<string, unknown>
    : undefined
  if (event['type'] === 'request/header') {
    const headerRecord = record?.['header'] as Record<string, unknown>
    const config = headerRecord['config']
    if (!hasProviderModel(config)) throw new Error(`seed request/header at index ${index} lacks provider/model`)
    const configRecord = config as Record<string, unknown>
    const reasoningEffort = configRecord['reasoningEffort']
    if (reasoningEffort !== undefined
      && (typeof reasoningEffort !== 'string' || reasoningEffort.length === 0)) {
      throw new Error(`seed request/header at index ${index} has an invalid reasoningEffort`)
    }
    assertAdapterDefaults(headerRecord['adapterDefaults'], configRecord, index)
    const reason = record?.['reason']
    if (reason !== 'initial' && reason !== 'resume' && reason !== 'change' && reason !== 'series') {
      throw new Error(`seed request/header at index ${index} has an invalid reason`)
    }
    if (record?.['startsSeries'] !== undefined && record['startsSeries'] !== true) {
      throw new Error(`seed request/header at index ${index} has an invalid startsSeries marker`)
    }
  }
  const type = event['type']
  if (type === 'assistant/attempt') {
    assertAssistantSettlementShape(record, type, index)
    return
  }
  if (!isMessageEventType(type)) return
  assertMessageEventShape(event, `seed ${type} at index ${index}`)
  if (type === 'assistant/message') {
    assertAssistantSettlementShape(record, type, index)
  }
}

/** Validate fields used directly by restored Session lifecycle logic without replaying the embedded stream. */
function assertAssistantSettlementShape(
  data: Record<string, unknown> | undefined,
  type: 'assistant/attempt' | 'assistant/message',
  index: number,
): void {
  const turn = data?.['turn']
  const step = data?.['step']
  if (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 0 || Object.is(turn, -0)
    || typeof step !== 'number' || !Number.isSafeInteger(step) || step < 0 || Object.is(step, -0)
    || !Array.isArray(data?.['stream'])) {
    throw new Error(`seed ${type} at index ${index} has invalid settlement fields`)
  }
}

const allowedAdapterKeys = new Set(['reasoningEffort', 'maxTokens'])

/** Validate adapter-default markers imported from a durable request header. */
function assertAdapterDefaults(
  value: unknown,
  config: Record<string, unknown>,
  index: number,
): void {
  if (value === undefined) return
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`seed request/header at index ${index} has invalid adapterDefaults`)
  }
  const defaults = value as Record<string, unknown>
  if (Object.keys(defaults).some(key => !allowedAdapterKeys.has(key))
    || Object.values(defaults).some(marker => marker !== true)
    || defaults['reasoningEffort'] === true && config['reasoningEffort'] === undefined
    || defaults['maxTokens'] === true && config['maxTokens'] === undefined) {
    throw new Error(`seed request/header at index ${index} has invalid adapterDefaults`)
  }
}

/** The four surface event types whose payload carries an identified message. */
function isMessageEventType(type: unknown): type is SurfaceEventType {
  return type === 'system/message' || type === 'user/message'
    || type === 'assistant/message' || type === 'tool/result'
}

const MESSAGE_ROLE_BY_TYPE: Record<SurfaceEventType, Message['role']> = {
  'system/message': 'system',
  'user/message': 'user',
  'assistant/message': 'assistant',
  'tool/result': 'user',
}

/** Validate only the event-specific invariants needed to safely replay a message. */
function assertMessageEventShape(event: Record<string, unknown>, subject: string): void {
  const type = event['type']
  if (!isMessageEventType(type)) return
  const data = event['data']
  const record = typeof data === 'object' && data !== null
    ? data as Record<string, unknown>
    : undefined
  const message = type === 'user/message' ? record : record?.['message']
  if (typeof message !== 'object' || message === null
    || typeof (message as Record<string, unknown>)['id'] !== 'string'
    || (message as Record<string, unknown>)['id'] === '') {
    throw new Error(`${subject} lacks an identified message`)
  }
  const messageRecord = message as Record<string, unknown>
  const expectedRole = MESSAGE_ROLE_BY_TYPE[type]
  if (messageRecord['role'] !== expectedRole) {
    throw new Error(`${subject} message must have role "${expectedRole}"`)
  }
  const source = messageRecord['source']
  if (typeof source !== 'object' || source === null
    || typeof (source as Record<string, unknown>)['kind'] !== 'string'
    || (source as Record<string, unknown>)['kind'] === '') {
    throw new Error(`${subject} message has invalid source`)
  }
  if (!Array.isArray(messageRecord['content'])) {
    throw new Error(`${subject} message has invalid content`)
  }
  const sourceRecord = source as Record<string, unknown>
  if (type === 'system/message') {
    if (sourceRecord['kind'] !== 'plugin' || typeof sourceRecord['plugin'] !== 'string'
      || sourceRecord['plugin'] === '') {
      throw new Error(`${subject} message must have plugin source`)
    }
    return
  }
  if (type === 'assistant/message') {
    if (sourceRecord['kind'] !== 'model' || !hasProviderModel(sourceRecord)) {
      throw new Error(`${subject} message must have model source`)
    }
    return
  }
  if (type !== 'tool/result') return
  if (sourceRecord['kind'] !== 'tool'
    || typeof sourceRecord['callId'] !== 'string'
    || sourceRecord['callId'] === '') {
    throw new Error(`${subject} message must have tool source`)
  }
  const content = messageRecord['content'] as unknown[]
  const block = content[0]
  if (content.length !== 1 || typeof block !== 'object' || block === null
    || (block as Record<string, unknown>)['type'] !== 'tool-result'
    || !Array.isArray((block as Record<string, unknown>)['content'])) {
    throw new Error(`${subject} message must contain one tool-result block`)
  }
  if ((block as Record<string, unknown>)['toolCallId'] !== sourceRecord['callId']) {
    throw new Error(`${subject} message has mismatched tool call ids`)
  }
}

/** Whether an unknown value carries the current provider/model pair. */
function hasProviderModel(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const pair = value as Record<string, unknown>
  return typeof pair['provider'] === 'string' && pair['provider'].length > 0
    && typeof pair['model'] === 'string' && pair['model'].length > 0
}

/** Parse one decoded event using the current Session seed/message validators.
 * @param value - exclusively owned wire event.
 * @param index - contiguous history position.
 * @returns validated event; unknown types require the ignorable marker.
 */
export function parseSessionEvent(value: unknown, index: number): SessionEvent {
  assertSessionEventEnvelope(value, index)
  if (value.seq !== index) throw new Error('Session history sequence is not contiguous')
  if (!KNOWN_SESSION_EVENT_TYPES.has(value.type) && value.ignorable !== true) {
    throw new Error('Session event type is unknown and not marked ignorable')
  }
  return adoptSessionEvent(value)
}
