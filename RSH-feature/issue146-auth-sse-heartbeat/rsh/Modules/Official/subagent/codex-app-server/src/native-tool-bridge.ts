import { fileHandleText, type ContentBlock, type UserMessage } from '@deepseek-ai/dsh-llm/native'
import type {
  NativeExternalJsonValue,
  NativeExternalToolCall,
  NativeExternalToolCallGrant,
  NativeExternalToolSettlement,
  NativeExternalSubagentModelOperations,
} from '@deepseek-ai/dsh-native-subagent/native'
import type { StoredImageAttachment } from '@deepseek-ai/dsh-native-tools'
import type { CodexDynamicToolCatalog } from './dynamic-tools.ts'

/** Text or verified inline image content returned for one accepted app-server tool call. */
export type CodexDynamicToolContentItem =
  | { readonly type: 'inputText'; readonly text: string }
  | { readonly type: 'inputImage'; readonly imageUrl: string }

/** Pinned app-server result returned for one dynamic tool request. */
export interface CodexDynamicToolCallResponse {
  readonly contentItems: readonly CodexDynamicToolContentItem[]
  readonly success: boolean
}

/** Durable Native tool result that concludes the exact active Codex turn. */
export interface CodexConcludingToolReply {
  readonly threadId: string
  readonly turnId: string
  readonly result: NativeExternalToolSettlement['result']
}

interface IssuedToolCall {
  readonly generation: number
  readonly call: NativeExternalToolCall
  readonly grant: NativeExternalToolCallGrant
  readonly namespace: string | null
}

interface ActiveToolCall {
  readonly threadId: string
  readonly turnId: string
  readonly params: Record<string, unknown>
  execution: Promise<void>
  response?: CodexDynamicToolCallResponse
}

interface ContextBatch {
  readonly messages: readonly UserMessage[]
  readonly images: readonly StoredImageAttachment[]
}

/** Ordered Engine contexts and verified image bytes reserved for one recorded request. */
export interface CodexSettlementContextReservation {
  readonly messages: readonly UserMessage[]
  readonly images: readonly StoredImageAttachment[]
}

interface ReservedContexts extends CodexSettlementContextReservation {
  readonly batchCount: number
}

function waitForTurnIdentity(signal: AbortSignal, turnIdentity: Promise<string>): Promise<string> {
  if (signal.aborted) return Promise.reject(abortError(signal))
  let removeAbortListener = (): void => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => { reject(abortError(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    removeAbortListener = () => { signal.removeEventListener('abort', onAbort) }
  })
  return Promise.race([turnIdentity, aborted]).finally(removeAbortListener)
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason))
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => jsonEqual(value, right[index]))
  }
  if (!record(left) || !record(right)) return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual(left[key], right[key]))
}

function imageFor(ref: Extract<ContentBlock, { type: 'image' }>['attachment'], images: readonly StoredImageAttachment[]): StoredImageAttachment {
  const image = images.find(candidate => String(candidate.ref.attachmentId) === String(ref.attachmentId))
  if (image === undefined || !jsonEqual(image.ref, ref)) {
    throw new Error('codex-app-server: Native tool image bytes do not match the accepted image reference')
  }
  return image
}

function imageDataUrl(image: StoredImageAttachment): string {
  return `data:${image.ref.mediaType};base64,${Buffer.from(image.data).toString('base64')}`
}

function projectContent(
  blocks: readonly ContentBlock[],
  images: readonly StoredImageAttachment[],
): CodexDynamicToolContentItem[] {
  const projected: CodexDynamicToolContentItem[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        projected.push({ type: 'inputText', text: block.text })
        break
      case 'image':
        projected.push({ type: 'inputImage', imageUrl: imageDataUrl(imageFor(block.attachment, images)) })
        break
      case 'file':
        projected.push({ type: 'inputText', text: fileHandleText(block.attachment, undefined) })
        break
      case 'tool-result':
        projected.push(...projectContent(block.content, images))
        break
      case 'tool-call':
        throw new Error('codex-app-server: Native tool result contains an executable tool call')
      default:
        // ContentBlockMap is merge-extensible; Codex cannot represent unknown Engine result blocks.
        throw new Error('codex-app-server: Native tool result contains an unsupported content block')
    }
  }
  return projected
}

function projectContext(
  messages: readonly UserMessage[],
  images: readonly StoredImageAttachment[],
): NativeExternalJsonValue[] {
  return messages.map((message) => {
    return {
      type: 'message',
      role: 'user',
      content: projectContent(message.content, images).map(item => item.type === 'inputText'
        ? { type: 'input_text', text: item.text }
        : { type: 'input_image', image_url: item.imageUrl }),
    }
  })
}

/** Owns one Native operation's exact dynamic-tool grants, settlements, and continuation contexts. */
export class NativeCodexToolBridge {
  private readonly issued = new Map<string, IssuedToolCall>()
  private readonly usedCallIds = new Set<string>()
  private readonly active = new Set<ActiveToolCall>()
  private readonly contextBatches: ContextBatch[] = []
  private threadId: string | undefined
  private turnId: string | undefined
  private readonly turnIdentity = Promise.withResolvers<string>()
  private turnIdentitySettled = false
  private generation = 0
  private reservedContexts: ReservedContexts | undefined
  private toolAdmissionOpen = true
  private transportFailure: Error | undefined
  private conclusionRequested = false
  private conclusionReady: CodexConcludingToolReply | undefined
  private trustedConclusionReturned = false
  private readonly pendingExecution = new Set<Promise<void>>()

  /** @param model - the exact Native model-operation owner for this run.
   * @param catalog - the captured direct-tool descriptors advertised to Codex.
   */
  constructor(
    private readonly model: NativeExternalSubagentModelOperations,
    readonly catalog: CodexDynamicToolCatalog,
  ) {
    void this.turnIdentity.promise.catch(() => {})
  }

  /** Bind the thread returned by `thread/start` before accepting response grants.
   * @param threadId - authoritative ephemeral thread identifier.
   */
  bindThread(threadId: string): void {
    if (this.threadId !== undefined && this.threadId !== threadId) {
      throw new Error('codex-app-server: dynamic tools were rebound to another thread')
    }
    this.threadId = threadId
  }

  /** Bind the turn returned by `turn/start` before accepting dynamic calls.
   * @param turnId - authoritative active turn identifier.
   */
  bindTurn(turnId: string): void {
    if (this.threadId === undefined) throw new Error('codex-app-server: dynamic tool turn has no bound thread')
    if (!this.toolAdmissionOpen) throw new Error('codex-app-server: dynamic tool turn was bound after admission closed')
    if (this.turnId !== undefined && this.turnId !== turnId) {
      throw new Error('codex-app-server: dynamic tools were rebound to another turn')
    }
    this.turnId = turnId
    if (!this.turnIdentitySettled) {
      this.turnIdentitySettled = true
      this.turnIdentity.resolve(turnId)
    }
  }

  /** Retain only grants returned after this exact model response was recorded.
   * @param sequence - Engine model-attempt generation.
   * @param calls - parsed function calls from the completed Responses object.
   * @param grants - opaque authorities returned by `recordModelResponse`.
   */
  registerResponseGrants(
    sequence: number,
    calls: readonly NativeExternalToolCall[],
    grants: readonly NativeExternalToolCallGrant[],
  ): void {
    if (!this.modelAdmissionOpen || this.threadId === undefined) {
      throw new Error('codex-app-server: cannot register grants before the active thread or after model admission closes')
    }
    if (!Number.isSafeInteger(sequence) || sequence <= this.generation || this.issued.size > 0 || this.active.size > 0) {
      throw new Error('codex-app-server: dynamic tool grants belong to a stale or unsettled response generation')
    }
    if (calls.length !== grants.length) throw new Error('codex-app-server: Engine grant count differs from the recorded tool calls')
    const pending: IssuedToolCall[] = []
    for (const [index, call] of calls.entries()) {
      const grant = grants[index]
      const namespace = this.catalog.namespaceFor(call.name)
      const callId = String(call.callId)
      if (grant === undefined || namespace === undefined || callId.length === 0
        || this.usedCallIds.has(callId) || String(grant.callId) !== callId || grant.name !== call.name
        || !jsonEqual(grant.arguments, call.arguments)) {
        throw new Error('codex-app-server: Engine returned a grant that differs from the recorded response call')
      }
      pending.push({ generation: sequence, call, grant, namespace })
    }
    this.generation = sequence
    for (const entry of pending) {
      const callId = String(entry.call.callId)
      this.usedCallIds.add(callId)
      this.issued.set(callId, entry)
    }
  }

  /** Execute one pinned app-server `item/tool/call` against its exact recorded grant.
   * @param params - parsed app-server dynamic call parameters.
   * @param signal - the published run cancellation signal.
   * @returns the pinned `DynamicToolCallResponse` fields.
   */
  async executeCall(params: Record<string, unknown>, signal: AbortSignal): Promise<CodexDynamicToolCallResponse> {
    const threadId = this.threadId
    const turnId = this.turnId
    const callId = params.callId
    const name = params.tool
    if (!this.toolAdmissionOpen || threadId === undefined
      || params.threadId !== threadId || typeof params.turnId !== 'string'
      || typeof callId !== 'string' || typeof name !== 'string') {
      throw new Error('codex-app-server: dynamic tool call does not match the active granted thread and turn')
    }
    const entry = this.issued.get(callId)
    const namespace = params.namespace === undefined || params.namespace === null ? null : params.namespace
    if (entry === undefined || entry.generation !== this.generation || entry.call.name !== name
      || entry.namespace !== namespace || !jsonEqual(entry.call.arguments, params.arguments)) {
      throw new Error('codex-app-server: dynamic tool call does not match an unused recorded response grant')
    }
    const authoritativeTurnId = turnId ?? await waitForTurnIdentity(signal, this.turnIdentity.promise)
    if (!this.hasToolAdmission() || params.turnId !== authoritativeTurnId) {
      throw new Error('codex-app-server: dynamic tool call does not match the authoritative active turn')
    }
    if (this.issued.get(callId) !== entry) {
      throw new Error('codex-app-server: dynamic tool grant was closed while its turn identity was pending')
    }
    this.issued.delete(callId)
    const active: ActiveToolCall = {
      threadId,
      turnId: authoritativeTurnId,
      params,
      execution: Promise.resolve(),
    }
    this.active.add(active)
    const execution = (async (): Promise<CodexDynamicToolCallResponse> => {
      signal.throwIfAborted()
      const settlement = await this.model.executeTool(entry.grant, signal)
      signal.throwIfAborted()
      const contentItems = projectContent(settlement.result.content, settlement.images)
      const response: CodexDynamicToolCallResponse = {
        contentItems,
        success: !settlement.result.isError,
      }
      if (settlement.concludesTurn && settlement.result.isError) {
        throw new Error('codex-app-server: an unsuccessful Native tool result cannot conclude the turn')
      }
      this.contextBatches.push({
        messages: structuredClone([
          ...(settlement.result.additionalContexts ?? []),
          ...settlement.settlementContexts,
        ]),
        images: structuredClone(settlement.images),
      })
      active.response = response
      if (settlement.concludesTurn && !this.conclusionRequested) {
        this.conclusionRequested = true
        this.conclusionReady = {
          threadId,
          turnId: authoritativeTurnId,
          result: structuredClone(settlement.result),
        }
      }
      return response
    })()
    active.execution = execution.then(() => {}, () => {})
    this.pendingExecution.add(active.execution)
    void active.execution.finally(() => { this.pendingExecution.delete(active.execution) })
    try {
      return await execution
    } catch (error: unknown) {
      this.active.delete(active)
      if (!signal.aborted) {
        this.transportFailed(error instanceof Error ? error : new Error(String(error)))
      }
      throw error
    }
  }

  /** Observe a successful JSON-RPC reply-frame write for one accepted tool call.
   * @param method - incoming server request method.
   * @param params - the same parameter object accepted by {@link executeCall}.
   * @param result - the exact result value returned by {@link executeCall}.
   * @returns the trusted conclusion once every already-accepted reply was written.
   */
  requestResultWritten(method: string, params: Record<string, unknown>, result: unknown): CodexConcludingToolReply | undefined {
    if (method !== 'item/tool/call') return undefined
    const active = [...this.active].find(call => call.params === params)
    if (active === undefined || active.response !== result) {
      throw new Error('codex-app-server: a dynamic tool reply was written without its accepted call')
    }
    this.active.delete(active)
    if (!this.conclusionRequested || this.issued.size > 0 || this.active.size > 0) return undefined
    const conclusion = this.conclusionReady
    this.conclusionReady = undefined
    this.trustedConclusionReturned = conclusion !== undefined
    return conclusion
  }

  /** Latch a transport failure so no later request can execute a tool.
   * @param error - non-cancellation transport failure to report through `model.fatal`.
   */
  transportFailed(error?: Error): void {
    this.closeAdmission()
    if (error !== undefined && this.transportFailure === undefined) {
      this.transportFailure = error
      this.model.fatal(error)
    }
  }

  /** Close future tool and model admission synchronously. */
  closeAdmission(): void {
    this.toolAdmissionOpen = false
    this.issued.clear()
    if (!this.turnIdentitySettled) {
      this.turnIdentitySettled = true
      this.turnIdentity.reject(new Error('codex-app-server: tool admission closed before the active turn was identified'))
    }
  }

  /** Drain accepted Engine executions and settlements without awaiting their reply callbacks.
   * @returns Resolves after every execution accepted by the Engine has settled.
   */
  async drainAccepted(): Promise<void> {
    this.closeAdmission()
    await Promise.all([...this.pendingExecution])
  }

  /** Whether another model request may begin.
   * @returns False after a trusted tool conclusion or operation teardown.
   */
  get modelAdmissionOpen(): boolean { return this.toolAdmissionOpen && !this.conclusionRequested }

  /** Whether closed model admission follows a written, trusted tool conclusion without transport failure.
   * @returns True only after every accepted reply was written and the conclusion was returned to the turn owner.
   */
  get trustedConclusionClosedModelAdmission(): boolean {
    return this.trustedConclusionReturned && this.transportFailure === undefined
  }

  /** Reserve settlement contexts so a durable model-request event can consume them once.
   * @returns a reservation with ordered accepted contexts and their exact verified images.
   */
  reserveContexts(): CodexSettlementContextReservation {
    if (this.reservedContexts !== undefined) throw new Error('codex-app-server: settlement contexts are already reserved')
    if (this.issued.size > 0 || this.active.size > 0) {
      throw new Error('codex-app-server: settlement contexts cannot be reserved before the previous tool batch is settled')
    }
    const batchCount = this.contextBatches.length
    const batches = this.contextBatches.slice(0, batchCount)
    const reservation: ReservedContexts = {
      batchCount,
      messages: batches.flatMap(batch => batch.messages),
      images: batches.flatMap(batch => batch.images),
    }
    this.reservedContexts = reservation
    return reservation
  }

  /** Consume contexts only after their final projected request has been durably admitted.
   * @param reservation - exact object returned from {@link reserveContexts}.
   */
  commitContexts(reservation: CodexSettlementContextReservation): void {
    const current = this.requireReservation(reservation)
    this.contextBatches.splice(0, current.batchCount)
    this.reservedContexts = undefined
  }

  /** Leave contexts queued when the corresponding request was not durably admitted.
   * @param reservation - exact object returned from {@link reserveContexts}.
   */
  releaseContexts(reservation: CodexSettlementContextReservation): void {
    this.requireReservation(reservation)
    this.reservedContexts = undefined
  }

  /** Project reserved contexts into self-contained Responses input items.
   * @param reservation - exact object returned from {@link reserveContexts}.
   * @returns ordered user messages using only captured text and verified image bytes.
   */
  projectContexts(reservation: CodexSettlementContextReservation): NativeExternalJsonValue[] {
    this.requireReservation(reservation)
    return projectContext(reservation.messages, reservation.images)
  }

  private requireReservation(reservation: CodexSettlementContextReservation): ReservedContexts {
    const current = this.reservedContexts
    if (current === undefined || current !== reservation) {
      throw new Error('codex-app-server: settlement context reservation is foreign or already settled')
    }
    return current
  }

  private hasToolAdmission(): boolean {
    return this.toolAdmissionOpen
  }
}
