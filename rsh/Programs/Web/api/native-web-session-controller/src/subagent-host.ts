/** Native Host wrappers for session fork and direct subagent control. */
import { randomUUID } from 'node:crypto'
import type { NativeSubagentCatalogEntry, NativeSubagentOperations } from '@redspark/rsh-native-subagent'
import type { NativeAgent } from '@redspark/rsh-native-agent'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner, NativeRootForkRequest } from '@redspark/rsh-native-session-execution'
import type { NativeRootRouteId } from '@redspark/rsh-native-session-execution/root-route'
import { readNativeSessionHistory, type NativeSessionHistoryCleanupError } from '@redspark/rsh-native-session-execution/read-history'
import type { NativeSessionPersistenceOperations } from '@redspark/rsh-session-persistence/native'
import { SessionPersistenceNotFoundError } from '@redspark/rsh-session-persistence/native'
import { SessionId } from '@redspark/rsh-session/native'
import { SessionSeq, type SessionEvent, type SessionHeader } from '@redspark/rsh-session/types'
import type { AttachmentOperations } from '@redspark/rsh-attachment/native'
import type { AdmittedPromptContentPart, PromptContentPart } from '@redspark/rsh-attachment/types'
import type { ContentBlock, MessageId } from '@redspark/rsh-llm/native'
import { foldSubagentDescriptor, type SubagentDescriptorData } from '@redspark/rsh-subagent-protocol/descriptor'
import { canonicalClientTimeZone } from '@redspark/rsh-util-time'
import { z } from 'zod'

/** Failure whose wire message is fixed and does not include engine text, paths, or secrets. */
export class NativeHostControlError extends Error {
  /** Session ids and catalog reasons returned with the fixed message. */
  readonly details: Readonly<Record<string, unknown>>

  /**
   * @param code - stable RPC code.
   * @param message - generic wire message.
   * @param details - session ids and catalog reasons only.
   */
  constructor(readonly code: string, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message)
    this.name = 'NativeHostControlError'
    this.details = details
  }
}

/** Authorities selected by the Native Web Session host for one control call. */
export interface NativeWebSubagentHostDeps {
  readonly active: NativeActiveSessionOperations
  readonly persistence: NativeSessionPersistenceOperations
  readonly subagents: NativeSubagentOperations | undefined
  readonly attachments: AttachmentOperations | undefined
  readonly executionFor: ((agent: NativeAgent) => { readonly status: string }) | undefined
  readonly maxHistoryEvents: number
  readonly maxPromptChars: number
  readonly onCleanupFailure: (error: NativeSessionHistoryCleanupError) => void
  /**
   * @param id - source or invocation-root Session.
   * @param signal - caller cancellation.
   * @param header - durable header the caller already read, avoiding a second read for its parent.
   * @returns the Program route that already owns that Session.
   */
  routeForSession(id: SessionId, signal: AbortSignal, header?: SessionHeader): Promise<NativeRootRouteId>
  /**
   * @param request - minted destination plus the selected source route.
   * @param signal - caller cancellation.
   * @returns the destination Session id after the Engine fork commits.
   */
  fork(request: NativeRootForkRequest, signal: AbortSignal): Promise<SessionId>
  /**
   * @param request - idle invocation root to resume.
   * @param operation - list call bound to the resumed owner.
   * @param signal - caller cancellation.
   * @returns the operation result after idle admission.
   */
  executeSessionOperation<T>(
    request: { readonly id: SessionId; readonly resume: boolean; readonly route: NativeRootRouteId },
    operation: (owner: NativeActiveSessionOwner, signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
  ): Promise<T>
}

type HostHistory = {
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
  readonly inheritedEventCount: number
}

type CatalogChild = {
  readonly kind: 'child'
  readonly id: SessionId
  readonly activity: 'running' | 'inactive'
  readonly hasChildren: boolean
  readonly mode: 'one-shot' | 'continuable'
  readonly label?: string
}

type CatalogDiagnostic = {
  readonly kind: 'diagnostic'
  readonly id: SessionId
  readonly reason: 'corrupt' | 'unsupported' | 'unavailable'
}

type CatalogEntry = CatalogChild | CatalogDiagnostic

type SubagentAddress = {
  readonly kind: 'subagent'
  readonly parentSessionId: SessionId
  readonly childSessionId: SessionId
  readonly mode: 'one-shot' | 'continuable'
}

const sessionText = z.string().min(1).max(256)
const imagePart = z.strictObject({
  type: z.literal('image'),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  data: z.string().min(1),
  name: z.string().min(1).optional(),
})
const textPart = z.strictObject({ type: z.literal('text'), text: z.string() })
const forkRequest = z.strictObject({
  sessionId: sessionText,
  atSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
})
const listRequest = z.strictObject({ parentSessionId: sessionText })
const promptRequest = z.strictObject({
  requestId: sessionText,
  parentSessionId: sessionText,
  childSessionId: sessionText,
  mode: z.literal('continuable'),
  delivery: z.enum(['queue', 'steer']),
  content: z.array(z.discriminatedUnion('type', [textPart, imagePart])).min(1).max(32),
  clientTimeZone: z.string().max(200).optional(),
})
const interruptRequest = z.strictObject({
  parentSessionId: sessionText,
  childSessionId: sessionText,
  mode: z.literal('continuable'),
})
const historyRequest = z.strictObject({
  address: z.strictObject({
    kind: z.literal('subagent'),
    parentSessionId: sessionText,
    childSessionId: sessionText,
    mode: z.enum(['one-shot', 'continuable']),
  }),
})
const followRequest = z.strictObject({
  parentSessionId: sessionText,
  childSessionId: sessionText,
  mode: z.enum(['one-shot', 'continuable']),
  lastSeq: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER),
})

function invalidRequest(): never {
  throw new NativeHostControlError('gateway/bad-request', 'Session request is invalid.', {})
}

function parsePayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) invalidRequest()
  return parsed.data
}

function liveOwner(active: NativeActiveSessionOperations, id: SessionId): NativeActiveSessionOwner | undefined {
  return active.owners().find(owner => owner.session.id === id)
}

async function headerMap(deps: NativeWebSubagentHostDeps, signal: AbortSignal): Promise<Map<SessionId, SessionHeader>> {
  const stored = await deps.persistence.list({ signal })
  signal.throwIfAborted()
  const headers = new Map(stored.map(snapshot => [snapshot.header.id, snapshot.header]))
  for (const owner of deps.active.owners()) headers.set(owner.session.id, owner.session.header)
  return headers
}

function rootSession(headers: ReadonlyMap<SessionId, SessionHeader>, start: SessionId): SessionId | undefined {
  let current = start
  const seen = new Set<SessionId>()
  while (!seen.has(current)) {
    seen.add(current)
    const header = headers.get(current)
    // Callers pass an id already stored in this map, and the walk only advances to a stored parent.
    /* v8 ignore next -- header is present for every id this walk visits */
    if (header === undefined) return undefined
    if (header.origin !== 'subagent') return current
    const parent = header.parentSession
    if (parent === undefined || !headers.has(parent)) return undefined
    current = parent
  }
  return undefined
}

async function observeSession(deps: NativeWebSubagentHostDeps, id: SessionId, signal: AbortSignal): Promise<
  | { readonly kind: 'history'; readonly history: HostHistory }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unavailable' }
> {
  try {
    const history = await readNativeSessionHistory(id, {
      active: deps.active, persistence: deps.persistence, maxHistoryEvents: deps.maxHistoryEvents,
      label: 'native web subagent', onCleanupFailure: deps.onCleanupFailure,
    }, signal)
    return { kind: 'history', history }
  } catch (error: unknown) {
    if (signal.aborted) signal.throwIfAborted()
    if (error instanceof SessionPersistenceNotFoundError) return { kind: 'missing' }
    return { kind: 'unavailable' }
  }
}

function foldedDescriptor(history: HostHistory):
  | { readonly descriptor: SubagentDescriptorData }
  | { readonly reason: 'corrupt' | 'unsupported' | 'unavailable' } {
  const own = history.events.slice(history.inheritedEventCount)
  try {
    const descriptor = foldSubagentDescriptor(own)
    if (descriptor !== undefined) return { descriptor }
    if (own.some(event => event.type === 'subagent/descriptor')) return { reason: 'unsupported' }
    return { reason: 'unavailable' }
  } catch {
    return { reason: 'corrupt' }
  }
}

function isDirectChild(header: SessionHeader, parent: SessionHeader, parentId: SessionId): boolean {
  return header.origin === 'subagent' && header.parentSession === parentId && header.cwd === parent.cwd
}

function hasDirectChild(headers: ReadonlyMap<SessionId, SessionHeader>, id: SessionId, cwd: string | undefined): boolean {
  for (const header of headers.values()) {
    if (header.origin === 'subagent' && header.parentSession === id && header.cwd === cwd) return true
  }
  return false
}

function activityFor(status: 'running' | 'idle' | 'ready'): 'running' | 'inactive' {
  return status === 'running' ? 'running' : 'inactive'
}

function scannedActivity(deps: NativeWebSubagentHostDeps, id: SessionId): 'running' | 'inactive' {
  const owner = liveOwner(deps.active, id)
  if (owner === undefined) return 'inactive'
  const execution = deps.executionFor?.(owner.agent)
  return execution?.status === 'running' ? 'running' : 'inactive'
}

/**
 * Fork one closed source turn into a new root Session.
 * @param deps - selected persistence, route lookup, and Engine fork.
 * @param payload - source id and optional event anchor.
 * @param signal - caller cancellation.
 * @returns the minted destination id. The source Session is not modified here.
 */
export async function forkNativeWebSession(
  deps: NativeWebSubagentHostDeps, payload: unknown, signal: AbortSignal,
): Promise<{ readonly sessionId: SessionId }> {
  const request = parsePayload(forkRequest, payload)
  const source = SessionId(request.sessionId)
  const live = liveOwner(deps.active, source)
  const stored = live === undefined ? await deps.persistence.stat(source, { signal }) : undefined
  if (live === undefined && stored === undefined) {
    throw new NativeHostControlError('session/not-found', 'Session was not found.', { sessionId: source })
  }
  const id = SessionId(randomUUID())
  try {
    const route = await deps.routeForSession(source, signal, stored?.header)
    const atSeq = request.atSeq
    await deps.fork({ route, source, id, ...atSeq === undefined ? {} : { atSeq: SessionSeq(atSeq) } }, signal)
  } catch (error: unknown) {
    if (signal.aborted) signal.throwIfAborted()
    const message = error instanceof Error ? error.message : ''
    if (message.includes('fork source event does not exist') || message.includes('fork source turn has not closed')) {
      throw new NativeHostControlError('session/fork-unavailable', 'Session fork is unavailable.', { sessionId: source })
    }
    throw new NativeHostControlError('native/session', 'Session request failed.', {})
  }
  return { sessionId: id }
}

/**
 * List direct subagent children of one parent Session.
 * @param deps - selected Native subagent provider and Session readers.
 * @param payload - parent Session id.
 * @param signal - caller cancellation.
 * @returns catalog rows and whether that parent already had a live owner.
 */
export async function listNativeSubagents(deps: NativeWebSubagentHostDeps, payload: unknown, signal: AbortSignal): Promise<{
  readonly entries: readonly CatalogEntry[]
  readonly parentAvailable: boolean
}> {
  const request = parsePayload(listRequest, payload)
  const parentId = SessionId(request.parentSessionId)
  const headers = await headerMap(deps, signal)
  const parent = headers.get(parentId)
  if (parent === undefined) return { entries: [], parentAvailable: false }
  const subagents = deps.subagents
  if (subagents === undefined) throw new NativeHostControlError('subagent/projections-unavailable', 'Subagent catalog is unavailable.', {})
  const parentLive = liveOwner(deps.active, parentId) !== undefined
  const listFrom = async (owner: NativeActiveSessionOwner, scopeSignal: AbortSignal): Promise<readonly NativeSubagentCatalogEntry[]> => {
    const scope = owner.session.id === parentId ? 'children' as const : 'descendants' as const
    const rows = await subagents.list({ agent: owner.agent, session: owner.session, scope }, scopeSignal)
    return scope === 'children' ? rows : rows.filter(row => row.parent === parentId)
  }
  const parentOwner = liveOwner(deps.active, parentId)
  const listed = parentOwner !== undefined
    ? await listFrom(parentOwner, signal)
    : await (async () => {
      const rootId = rootSession(headers, parentId)
      if (rootId === undefined) return []
      const rootOwner = liveOwner(deps.active, rootId)
      if (rootOwner !== undefined) return listFrom(rootOwner, signal)
      const route = await deps.routeForSession(rootId, signal)
      return deps.executeSessionOperation(
        { id: rootId, resume: true, route },
        (owner, operationSignal) => listFrom(owner, operationSignal),
        signal,
      )
    })()
  const sortable: { readonly entry: CatalogEntry; readonly createdAt: number; readonly id: SessionId }[] = []
  const seen = new Set<SessionId>()
  for (const row of listed) {
    const header = headers.get(row.id)
    if (header === undefined || !isDirectChild(header, parent, parentId)) continue
    seen.add(row.id)
    if (row.kind === 'diagnostic') {
      sortable.push({ id: row.id, createdAt: header.createdAt, entry: { kind: 'diagnostic', id: row.id, reason: row.reason } })
      continue
    }
    const hasChildren = hasDirectChild(headers, row.id, parent.cwd)
    sortable.push({ id: row.id, createdAt: header.createdAt, entry: {
      kind: 'child', id: row.id, activity: activityFor(row.status), hasChildren, mode: 'continuable', label: row.label,
    } })
  }
  for (const header of headers.values()) {
    if (seen.has(header.id) || !isDirectChild(header, parent, parentId)) continue
    const observed = await observeSession(deps, header.id, signal)
    if (observed.kind === 'missing') continue
    if (observed.kind === 'unavailable') {
      sortable.push({ id: header.id, createdAt: header.createdAt, entry: { kind: 'diagnostic', id: header.id, reason: 'unavailable' } })
      continue
    }
    const folded = foldedDescriptor(observed.history)
    if (!('descriptor' in folded)) {
      sortable.push({ id: header.id, createdAt: header.createdAt, entry: { kind: 'diagnostic', id: header.id, reason: folded.reason } })
      continue
    }
    const descriptor = folded.descriptor
    const hasChildren = hasDirectChild(headers, header.id, parent.cwd)
    const activity = scannedActivity(deps, header.id)
    sortable.push({ id: header.id, createdAt: header.createdAt, entry: descriptor.mode === 'one-shot'
      ? { kind: 'child', id: header.id, activity, hasChildren, mode: 'one-shot', ...descriptor.label === undefined ? {} : { label: descriptor.label } }
      : { kind: 'child', id: header.id, activity, hasChildren, mode: 'continuable', label: descriptor.label } })
  }
  sortable.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
  return { entries: sortable.map(item => item.entry), parentAvailable: parentLive }
}

function requireParent(headers: ReadonlyMap<SessionId, SessionHeader>, parentId: SessionId, child: SessionHeader): SessionHeader {
  const parent = headers.get(parentId)
  if (parent === undefined || !isDirectChild(child, parent, parentId)) {
    throw new NativeHostControlError('subagent/unauthorized', 'Subagent parent does not own this child.', { childSessionId: child.id })
  }
  return parent
}

async function addressedChild(deps: NativeWebSubagentHostDeps, parentId: SessionId, childId: SessionId, signal: AbortSignal): Promise<
  | { readonly kind: 'missing' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'history'; readonly history: HostHistory; readonly parent: SessionHeader; readonly headers: ReadonlyMap<SessionId, SessionHeader> }
> {
  const headers = await headerMap(deps, signal)
  const observed = await observeSession(deps, childId, signal)
  if (observed.kind !== 'history') return observed
  const parent = requireParent(headers, parentId, observed.history.header)
  return { kind: 'history', history: observed.history, parent, headers }
}

function promptContent(parts: readonly Extract<PromptContentPart, { type: 'text' }>[]): ContentBlock[] {
  return parts.map(part => ({ type: 'text', text: part.text }))
}

function admittedContent(parts: readonly AdmittedPromptContentPart[]): ContentBlock[] {
  const content: ContentBlock[] = []
  for (const part of parts) {
    if (part.type === 'text') content.push({ type: 'text', text: part.text })
    else if (part.type === 'image') content.push({ type: 'image', attachment: part.attachment })
    else throw new NativeHostControlError('subagent/attachment-invalid', 'Subagent attachment was rejected.', {})
  }
  return content
}

/**
 * Deliver one continuable prompt to a live direct child.
 * Queue and steer are both accepted. Native admission always uses the adjacent next-step inbox.
 * @param deps - live parent owner, attachment admission, and Native subagent provider.
 * @param payload - continuable prompt fields.
 * @param signal - caller cancellation before durable admission.
 * @returns the message id Native admission created.
 */
export async function promptNativeSubagent(
  deps: NativeWebSubagentHostDeps, payload: unknown, signal: AbortSignal,
): Promise<{ readonly messageId: MessageId }> {
  const request = parsePayload(promptRequest, payload)
  if (!request.content.some(part => part.type === 'image' || part.text.length > 0)) invalidRequest()
  const textLength = request.content.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : 0), 0)
  if (textLength > deps.maxPromptChars) invalidRequest()
  if (request.clientTimeZone !== undefined && canonicalClientTimeZone(request.clientTimeZone) === undefined) {
    throw new NativeHostControlError('subagent/invalid-time-zone', 'Subagent time zone is invalid.', { value: request.clientTimeZone })
  }
  const parentId = SessionId(request.parentSessionId)
  const childId = SessionId(request.childSessionId)
  const parentOwner = liveOwner(deps.active, parentId)
  if (parentOwner === undefined) throw new NativeHostControlError('subagent/parent-unavailable', 'Subagent parent is unavailable.', { parentSessionId: parentId })
  const addressed = await addressedChild(deps, parentId, childId, signal)
  if (addressed.kind === 'missing') throw new NativeHostControlError('subagent/not-found', 'Subagent was not found.', { parentSessionId: parentId, childSessionId: childId })
  if (addressed.kind === 'unavailable') throw new NativeHostControlError('native/session', 'Session request failed.', {})
  const folded = foldedDescriptor(addressed.history)
  if (!('descriptor' in folded)) {
    throw new NativeHostControlError('subagent/catalog-diagnostic', 'Subagent descriptor is unavailable.', {
      parentSessionId: parentId, childSessionId: childId, reason: folded.reason,
    })
  }
  if (folded.descriptor.mode !== 'continuable') {
    throw new NativeHostControlError('subagent/not-resumable', 'Subagent cannot accept a continuation.', { childSessionId: childId })
  }
  const subagents = deps.subagents
  if (subagents === undefined) throw new NativeHostControlError('subagent/projections-unavailable', 'Subagent catalog is unavailable.', {})
  const parts: PromptContentPart[] = request.content.map(part => part.type === 'text'
    ? { type: 'text', text: part.text }
    : { type: 'image', mediaType: part.mediaType, data: part.data, ...part.name === undefined ? {} : { name: part.name } })
  let content: readonly ContentBlock[]
  if (parts.some(part => part.type === 'image')) {
    const attachments = deps.attachments
    if (attachments === undefined) throw new NativeHostControlError('subagent/attachment-invalid', 'Subagent attachment was rejected.', {})
    try {
      content = admittedContent(await attachments.admitPromptContent(parts))
    } catch (error: unknown) {
      if (signal.aborted) signal.throwIfAborted()
      if (error instanceof NativeHostControlError) throw error
      throw new NativeHostControlError('subagent/attachment-invalid', 'Subagent attachment was rejected.', {})
    }
  } else content = promptContent(parts as readonly Extract<PromptContentPart, { type: 'text' }>[])
  let messageId: MessageId
  try {
    messageId = await subagents.sendMessage({ agent: parentOwner.agent, session: parentOwner.session, target: childId, content }, signal)
  } catch (error: unknown) {
    if (signal.aborted) signal.throwIfAborted()
    const message = error instanceof Error ? error.message : ''
    if (message.includes('does not name this direct parent') || message.includes('workspace differs')) {
      throw new NativeHostControlError('subagent/unauthorized', 'Subagent parent does not own this child.', { childSessionId: childId })
    }
    if (message.includes('no supported continuation')) {
      throw new NativeHostControlError('subagent/not-resumable', 'Subagent cannot accept a continuation.', { childSessionId: childId })
    }
    throw new NativeHostControlError('subagent/delivery-unavailable', 'Subagent delivery is unavailable.', { childSessionId: childId })
  }
  return { messageId }
}

/**
 * Interrupt one continuable child without cancelling its parent turn.
 * @param deps - live ancestor owner and Native subagent provider.
 * @param payload - direct parent, child, and continuable mode.
 * @param signal - caller cancellation before the header check.
 * @returns acceptance when the Engine signal was issued, or when the child is missing or not live.
 */
export async function interruptNativeSubagent(
  deps: NativeWebSubagentHostDeps, payload: unknown, signal: AbortSignal,
): Promise<{ readonly accepted: true }> {
  const request = parsePayload(interruptRequest, payload)
  const parentId = SessionId(request.parentSessionId)
  const childId = SessionId(request.childSessionId)
  const addressed = await addressedChild(deps, parentId, childId, signal)
  if (addressed.kind === 'missing') return { accepted: true }
  if (addressed.kind === 'unavailable') throw new NativeHostControlError('native/session', 'Session request failed.', {})
  const folded = foldedDescriptor(addressed.history)
  if (!('descriptor' in folded) || folded.descriptor.mode !== 'continuable') {
    throw new NativeHostControlError('subagent/unauthorized', 'Subagent parent does not own this child.', { childSessionId: childId })
  }
  if (liveOwner(deps.active, childId) === undefined) return { accepted: true }
  const direct = liveOwner(deps.active, parentId)
  const rootId = rootSession(addressed.headers, parentId)
  const ancestor = direct ?? (rootId === undefined ? undefined : liveOwner(deps.active, rootId))
  if (ancestor === undefined) {
    throw new NativeHostControlError('subagent/parent-unavailable', 'Subagent parent is unavailable.', { parentSessionId: parentId })
  }
  const subagents = deps.subagents
  if (subagents === undefined) throw new NativeHostControlError('subagent/projections-unavailable', 'Subagent catalog is unavailable.', {})
  try {
    subagents.interrupt({ agent: ancestor.agent, session: ancestor.session, target: childId })
  } catch (error: unknown) {
    if (signal.aborted) signal.throwIfAborted()
    const message = error instanceof Error ? error.message : ''
    if (message.includes('interrupt requires a live ancestor')) {
      throw new NativeHostControlError('subagent/unauthorized', 'Subagent parent does not own this child.', { childSessionId: childId })
    }
    throw new NativeHostControlError('native/session', 'Session request failed.', {})
  }
  return { accepted: true }
}

/**
 * Read one subagent Session after its parent address is checked.
 * @param deps - Session readers.
 * @param payload - subagent address.
 * @param signal - caller cancellation.
 * @returns the same history fields as an ordinary Session read.
 */
export async function readAddressedSubagentHistory(
  deps: NativeWebSubagentHostDeps, payload: unknown, signal: AbortSignal,
): Promise<HostHistory> {
  const request = parsePayload(historyRequest, payload)
  return authorizeSubagentHistory(deps, {
    kind: 'subagent',
    parentSessionId: SessionId(request.address.parentSessionId),
    childSessionId: SessionId(request.address.childSessionId),
    mode: request.address.mode,
  }, signal)
}

/**
 * Parse a subagent follow body.
 * @param payload - parent, child, mode, and last applied sequence.
 * @returns branded address fields and the cursor.
 */
export function parseNativeSubagentFollow(payload: unknown): {
  readonly parentSessionId: SessionId
  readonly childSessionId: SessionId
  readonly mode: 'one-shot' | 'continuable'
  readonly lastSeq: number
} {
  const request = parsePayload(followRequest, payload)
  return {
    parentSessionId: SessionId(request.parentSessionId),
    childSessionId: SessionId(request.childSessionId),
    mode: request.mode,
    lastSeq: request.lastSeq,
  }
}

/**
 * Read a child selected by a follow or history address.
 * @param deps - Session readers.
 * @param address - parent, child, and descriptor mode.
 * @param signal - caller cancellation.
 * @returns bounded child history after parent, workspace, and descriptor checks.
 */
export async function authorizeSubagentHistory(
  deps: NativeWebSubagentHostDeps, address: SubagentAddress, signal: AbortSignal,
): Promise<HostHistory> {
  const addressed = await addressedChild(deps, address.parentSessionId, address.childSessionId, signal)
  if (addressed.kind === 'missing') {
    throw new NativeHostControlError('subagent/not-found', 'Subagent was not found.', {
      parentSessionId: address.parentSessionId, childSessionId: address.childSessionId,
    })
  }
  if (addressed.kind === 'unavailable') throw new NativeHostControlError('native/session', 'Session request failed.', {})
  const folded = foldedDescriptor(addressed.history)
  if (!('descriptor' in folded)) {
    throw new NativeHostControlError('subagent/catalog-diagnostic', 'Subagent descriptor is unavailable.', {
      parentSessionId: address.parentSessionId, childSessionId: address.childSessionId, reason: folded.reason,
    })
  }
  if (folded.descriptor.mode !== address.mode) {
    throw new NativeHostControlError('subagent/unauthorized', 'Subagent parent does not own this child.', { childSessionId: address.childSessionId })
  }
  return addressed.history
}

/**
 * Whether a follow cursor names an existing event, or `-1` before the first event.
 * @param events - bounded child history.
 * @param lastSeq - last event the caller already applied.
 * @returns true when the following baseline can start at the next sequence.
 */
export function nativeHistoryCursorFits(events: readonly { readonly seq: number }[], lastSeq: number): boolean {
  if (lastSeq === -1) return true
  const event = events[lastSeq]
  return event !== undefined && event.seq === lastSeq
}
