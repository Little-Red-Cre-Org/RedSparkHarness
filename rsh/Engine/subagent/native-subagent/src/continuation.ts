/** Continuable child admission over the selected Program's existing residency and writer. */
import { randomUUID } from 'node:crypto'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import { foldConsumedWork } from '@deepseek-ai/dsh-native-agent/consumed-work'
import type { NativeContext } from '@deepseek-ai/dsh-native-runtime'
import { createUserMessage, type ContentBlock, type MessageId } from '@deepseek-ai/dsh-llm/native'
import { SessionId, type Session } from '@deepseek-ai/dsh-session/native'
import type { NativeDelegationSetup, NativeSessionContinuation, NativeSessionContinuations, NativeContinuationObservation,
  NativeSessionTurnResult } from '@deepseek-ai/dsh-native-session-execution'
import { createAdjacentAgentMessage, createSettlementMessage, finalAssistantOutput, subagentEpochStopReason, foldSubagentDescriptor, snapshotSubagentDescriptor, withContinuableReturnGuidance, type ContinuableSubagentDescriptorData } from '@deepseek-ai/dsh-subagent-protocol'
import type { NativeSubagentCatalogEntry, NativeSubagentFinished, NativeSubagentRequest } from './index.ts'

interface OwnedChild { readonly handle: NativeSessionContinuation; readonly parent: NativeAgent }

/** Own selected child handles; all durable history and queued input remain Program-owned. */
export class NativeSubagentContinuations {
  private readonly children = new Map<SessionId, OwnedChild>()
  private readonly failures: unknown[] = []
  private readonly deliveries = new Map<SessionId, Promise<void>>()
  private closing = false

  /**
   * @param context - selected Provider scope.
   * @param provider - durable backend name.
   * @param prepare - shared child permission setup.
   * @param onFinished - publishes the actual settled result to subscribed consumers.
   */
  constructor(private readonly context: NativeContext, private readonly provider: string,
    private readonly prepare: (request: NativeSubagentRequest, setup: NativeDelegationSetup) => void,
    private readonly onFinished: (finished: NativeSubagentFinished) => void) {}

  /** Admit initial input without waiting for a model turn.
   * @param request - resolved child creation.
   * @param signal - pre-admission cancellation.
   * @returns actual child and accepted message identities.
   */
  async start(request: NativeSubagentRequest, signal: AbortSignal): Promise<{ id: SessionId; provider: string; messageId: MessageId }> {
    const operations = this.operations(request.agent, request.session)
    signal.throwIfAborted()
    const id = SessionId(randomUUID())
    const descriptor = snapshotSubagentDescriptor({ mode: 'continuable', provider: this.provider, label: request.label,
      agentProvider: request.config.provider, agentModel: request.config.model,
      ...request.config.reasoningEffort === undefined ? {} : { agentReasoningEffort: request.config.reasoningEffort },
      ...request.persona === undefined ? {} : { persona: request.persona },
      ...request.toolFilter === undefined ? {} : { toolFilter: request.toolFilter },
    })
    const child = await operations.open({ id, resume: false, config: request.config, maxDepth: request.maxDepth,
      prepare: (setup) => { this.prepare(request, setup) },
      onSettled: this.settlement(operations, request.agent, request.session, id, 0),
    }, signal)
    this.own(child, request.agent)
    try {
      signal.throwIfAborted()
      this.assertOpen()
      await operations.maintenance(id, async (owner, admitted) => {
        admitted.throwIfAborted()
        owner.append('subagent/descriptor', descriptor)
        await owner.flush()
      }, signal)
      const hasReturnTool = this.context.optional('tools')?.schemas(child.agent.scope).some(tool => tool.name === 'send_message') === true
      const content = hasReturnTool ? withContinuableReturnGuidance(request.session.id, [...request.prompt]) : [...request.prompt]
      const messageId = await child.enqueue(createUserMessage({ source: { kind: 'user' }, content }), 'next-turn', signal)
      return { id, provider: this.provider, messageId }
    } catch (error: unknown) { return this.closeAfterFailure(child, error) }
  }

  /** Deliver to an adjacent child or a resident child's parent.
   * @param agent - exact live sender.
   * @param session - sender's current Session.
   * @param target - durable recipient.
   * @param content - authored input.
   * @param signal - pre-admission cancellation.
   * @returns durably accepted message identity.
   */
  send(agent: NativeAgent, session: Session, target: SessionId, content: readonly ContentBlock[],
    signal: AbortSignal): Promise<MessageId> {
    const previous = this.deliveries.get(target) ?? Promise.resolve()
    const task = previous.then(() => this.deliver(agent, session, target, content, signal))
    // Each caller receives its failure; the sequencing tail does not reject later deliveries.
    const tail = task.then(() => undefined, () => undefined)
    this.deliveries.set(target, tail)
    void tail.then(() => { if (this.deliveries.get(target) === tail) this.deliveries.delete(target) })
    return task
  }

  private async deliver(agent: NativeAgent, session: Session, target: SessionId, content: readonly ContentBlock[],
    signal: AbortSignal): Promise<MessageId> {
    signal.throwIfAborted()
    const operations = this.operations(agent, session)
    const sender = this.children.get(session.id)
    if (session.header.parentSession === target) {
      if (sender?.handle.agent !== agent || sender.handle.isClosing) throw new Error('native-subagent: only a resident continuable child may send to its parent')
      return operations.deliver(target, createAdjacentAgentMessage(session.id, [...content]), 'next-turn', false, signal)
    }
    let child = this.children.get(target)
    if (child !== undefined && child.parent !== agent) throw new Error('native-subagent: recipient is not this exact parent\'s child')
    if (child?.handle.isClosing === true) { await child.handle.done; child = undefined }
    let materialized = false
    if (child === undefined) {
      const observed = await operations.observe(target, signal)
      if (typeof observed.header.cwd !== 'string' || observed.header.cwd !== session.header.cwd) throw new Error('native-subagent: stored child workspace differs from its parent')
      const descriptor = foldSubagentDescriptor(observed.events.slice(observed.inheritedEventCount))
      if (descriptor?.mode !== 'continuable' || descriptor.provider !== this.provider) throw new Error('native-subagent: child has no supported continuation for this Provider')
      const depth = (session.header.delegationDepth ?? 0) + 1
      if (observed.header.delegationDepth !== depth) throw new Error('native-subagent: stored child depth differs from its direct parent')
      const request = this.resolveRestored(agent, session, observed, descriptor, depth)
      const handle = await operations.open({ id: target, resume: true, config: request.config, maxDepth: depth,
        prepare: (setup) => { this.prepare(request, setup) },
        onSettled: this.settlement(operations, agent, session, target, observed.events.length),
      }, signal)
      child = this.own(handle, agent)
      materialized = true
      try { signal.throwIfAborted(); this.assertOpen() } catch (error: unknown) { return this.closeAfterFailure(handle, error) }
    }
    try { return await child.handle.enqueue(createAdjacentAgentMessage(session.id, [...content]), 'next-step', signal) }
    catch (error: unknown) {
      if (materialized) return this.closeAfterFailure(child.handle, error)
      throw error
    }
  }

  /** Observe continuable descriptors through the Program's selected corpus and authorized lineage.
   * @param agent - exact initiating identity.
   * @param session - active parent Session.
   * @param scope - direct children or complete descendants.
   * @param signal - listing and inspection cancellation.
   * @returns continuable rows and read diagnostics; one-shot and ordinary nodes remain traversal nodes.
   */
  async list(agent: NativeAgent, session: Session, scope: 'children' | 'descendants',
    signal: AbortSignal): Promise<readonly NativeSubagentCatalogEntry[]> {
    const operations = this.operations(agent, session)
    const candidates = await operations.catalog(scope, signal)
    const rows: NativeSubagentCatalogEntry[] = []
    for (const candidate of candidates) {
      signal.throwIfAborted()
      const id = candidate.path.at(-1) as SessionId
      const position = scope === 'children' ? {} : { parent: candidate.path.length === 1 ? session.id
        : candidate.path[candidate.path.length - 2] as SessionId, depth: candidate.path.length }
      const inspected = await operations.inspect(candidate.path, signal)
      if (inspected.kind === 'diagnostic') { rows.push({ ...inspected, ...position }); continue }
      const observed = inspected.observation
      const own = observed.events.slice(observed.inheritedEventCount)
      let descriptor
      try { descriptor = foldSubagentDescriptor(own) }
      catch {
        // Descriptor parsing alone rejects malformed durable fields; storage cleanup has already completed.
        rows.push({ kind: 'diagnostic', id, reason: 'corrupt', ...position })
        continue
      }
      if (descriptor === undefined && own.some(event => event.type === 'subagent/descriptor')) {
        rows.push({ kind: 'diagnostic', id, reason: 'unsupported', ...position })
        continue
      }
      if (descriptor?.mode === 'continuable' && descriptor.provider === this.provider) {
        rows.push({ kind: 'child', id, label: descriptor.label, status: candidate.status, ...position })
      }
    }
    return rows
  }

  /** Interrupt live descendants without discarding pending input.
   * @param agent - exact live ancestor.
   * @param session - ancestor's active Session.
   * @param target - addressed child.
   */
  interrupt(agent: NativeAgent, session: Session, target: SessionId): void {
    this.operations(agent, session)
    const child = this.children.get(target)
    if (child === undefined) return
    if (!agent.scope.contains(child.handle.agent.scope) || child.handle.agent === agent) throw new Error('native-subagent: interrupt requires a live ancestor')
    child.handle.interrupt({ kind: 'user' })
  }

  /** Close owned child admission and await Program cleanup.
   * @returns quiescence, rejecting with actual execution or cleanup failures.
   */
  async dispose(): Promise<void> {
    this.closing = true
    const results = await Promise.allSettled([...this.children.values()].map(child => child.handle.dispose()))
    const failures = new Set([...this.failures, ...results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])])
    if (failures.size > 0) throw new AggregateError([...failures], 'native-subagent: continuable child release failed')
  }

  private settlement(operations: NativeSessionContinuations, parent: NativeAgent, session: Session,
    id: SessionId, boundary: number): (result: NativeSessionTurnResult | undefined, failure: unknown,
    observation: NativeContinuationObservation | undefined) => Promise<void> {
    return async (result, failure, observation) => {
      const own = observation?.events.slice(boundary) ?? []
      const output = failure === undefined && observation !== undefined ? finalAssistantOutput(own) : undefined
      const stopReason = failure === undefined && observation !== undefined ? subagentEpochStopReason(foldConsumedWork(own)) : 'error'
      if (result !== undefined || failure !== undefined) {
        this.onFinished({ parentAgent: parent, parentSession: session,
          result: { id, provider: this.provider, output: output ?? [], stopReason } })
      }
      if (this.closing || this.context.signal.aborted || operations.isClosing || observation === undefined) return
      const terminal = { stopReason,
        ...output === undefined ? {} : { output } }
      const residentParent = this.children.get(session.id)
      const wake = residentParent?.handle.agent === parent && !residentParent.handle.isClosing
      await operations.deliver(session.id, createSettlementMessage(id, terminal), 'next-turn', wake, this.context.signal)
    }
  }

  private resolveRestored(agent: NativeAgent, session: Session, observed: NativeContinuationObservation,
    descriptor: ContinuableSubagentDescriptorData, depth: number): NativeSubagentRequest {
    return { agent, session, label: descriptor.label, prompt: [], maxDepth: depth,
      config: { cwd: observed.header.cwd as string, builtinTools: false, systemPrompt: observed.defaults.systemPrompt,
        maxSteps: observed.defaults.maxSteps,
        ...observed.defaults.maxTokens === undefined ? {} : { maxTokens: observed.defaults.maxTokens },
        provider: descriptor.agentProvider ?? observed.defaults.provider,
        model: descriptor.agentModel ?? observed.defaults.model,
        ...descriptor.agentReasoningEffort === undefined ? {} : { reasoningEffort: descriptor.agentReasoningEffort } },
      routeOverrides: {},
      ...descriptor.persona === undefined ? {} : { persona: descriptor.persona },
      ...descriptor.toolFilter === undefined ? {} : { toolFilter: descriptor.toolFilter },
    }
  }

  private operations(agent: NativeAgent, session: Session): NativeSessionContinuations {
    this.assertOpen()
    if (!this.context.scope.contains(agent.scope)) throw new Error('native-subagent: sender is outside this Provider scope')
    const execution = this.context.require('sessionExecution')
    execution.configuration(agent, session)
    if (execution.continuations === undefined) throw new Error('native-subagent: selected Program does not support continuable children')
    return execution.continuations(agent, session)
  }

  private assertOpen(): void {
    if (this.closing || this.context.signal.aborted) throw new Error('native-subagent: continuation admission is closed')
  }

  private own(handle: NativeSessionContinuation, parent: NativeAgent): OwnedChild {
    const child = { handle, parent }
    this.children.set(handle.id, child)
    const release = () => { if (this.children.get(handle.id) === child) this.children.delete(handle.id) }
    void handle.done.then(release, (error: unknown) => { this.failures.push(error); release() })
    return child
  }

  private async closeAfterFailure(handle: NativeSessionContinuation, error: unknown): Promise<never> {
    try { await handle.dispose() } catch (cleanup: unknown) {
      throw new AggregateError([error, cleanup], 'native-subagent: continuation admission and cleanup failed')
    }
    throw error
  }
}
