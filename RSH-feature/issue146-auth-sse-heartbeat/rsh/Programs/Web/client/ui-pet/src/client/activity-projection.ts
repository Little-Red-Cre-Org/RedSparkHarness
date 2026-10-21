/** Incremental pet activity projection over the existing Conversation assembler. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition, ConversationViewBuilder, ConversationViewNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-compaction/types'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { PetActivity } from './runtime.ts'

/** Latest lifecycle facts for a pet, independent from the visible Chat target. */
export interface PetLifecycle {
  seq: number
  startedAt: number
  active: boolean
  activity: PetActivity
}

/** Deployment-owned tool names used for semantic presentation. */
export interface PetToolPolicy {
  codingTools: readonly string[]
  planningTools: readonly string[]
}

interface TurnState extends PetLifecycle { tools: ReadonlyMap<string, PetActivity> }
interface PetNode extends ConversationViewNode { data: PetLifecycle }

/**
 * Register pet-only event Definitions and a bounded latest-lifecycle view.
 * @param ctx - Plugin context owning the registrations.
 * @param policy - Configured semantic tool names.
 */
export function registerPetProjection(ctx: Context, policy: PetToolPolicy): void {
  const turn: ConversationNodeDefinition<TurnState> = {
    kind: 'pet-turn', target: 'pet-activity',
    match(event) {
      switch (event.type) {
        case 'turn/start': return { id: String(event.data.turn), role: 'start' }
        case 'turn/end': case 'step/start': case 'tool/call': case 'tool/result':
        case 'llm/retry': case 'llm/retry-started':
          return { id: String(event.data.turn), role: 'update' }
        default: return null // Other event families do not change pet activity.
      }
    },
    start: (_context, match) => ({ seq: match.event.seq, startedAt: match.event.time, active: true, activity: 'thinking', tools: new Map() }),
    update(context, match) {
      const event = match.event
      const previous = context.state
      const state = { ...previous, seq: event.seq }
      switch (event.type) {
        case 'turn/end': return { ...state, active: false, tools: new Map(), activity: event.data.reason.kind === 'error' ? 'error' : 'idle' }
        case 'tool/call': {
          const activity = policy.codingTools.includes(event.data.name) ? 'coding'
            : policy.planningTools.includes(event.data.name) ? 'planning' : 'working'
          const tools = new Map(state.tools)
          tools.set(event.data.callId, activity)
          return { ...state, activity, tools }
        }
        case 'tool/result': {
          const tools = new Map(state.tools)
          tools.delete(event.data.message.source.callId)
          return { ...state, tools, activity: [...tools.values()].at(-1) ?? 'thinking' }
        }
        case 'llm/retry': return { ...state, activity: event.data.failure.code === 'RATE_LIMIT' ? 'sleeping' : 'thinking' }
        case 'llm/retry-started': case 'step/start': return { ...state, activity: 'thinking' }
        default: return previous // Only the matched lifecycle families have updates.
      }
    },
    buildViewNode: context => context.state === undefined ? null : ({
      key: context.key, id: context.id, kind: 'turn', target: 'pet-activity', data: context.state,
    }),
  }
  const compaction: ConversationNodeDefinition<PetLifecycle> = {
    kind: 'pet-compaction', target: 'pet-activity',
    match(event) {
      if (event.type === 'compaction/start' || event.type === 'compaction/end') {
        return { id: event.data.compactionId, role: event.type === 'compaction/start' ? 'start' : 'update' }
      }
      return null
    },
    start: (_context, match) => ({ seq: match.event.seq, startedAt: match.event.time, active: true, activity: 'compacting' }),
    update: (context, match) => ({ ...context.state, seq: match.event.seq, active: false }),
    buildViewNode: context => context.state === undefined ? null : ({
      key: context.key, id: context.id, kind: 'compaction', target: 'pet-activity', data: context.state,
    }),
  }
  ctx.uiConversation.events.register(turn)
  ctx.uiConversation.events.register(compaction)
  ctx.uiConversation.views.register({ target: 'pet-activity', create: createPetActivityBuilder, isActive: () => false })
}

/**
 * Creates an isolated incremental builder that retains only the latest turn and compaction lifecycle.
 * @returns The target-specific builder.
 */
export function createPetActivityBuilder(): ConversationViewBuilder<PetNode, PetLifecycle | undefined> {
  let turn: PetLifecycle | undefined
  let compaction: PetLifecycle | undefined
  const apply = (nodes: readonly PetNode[]): PetLifecycle | undefined => {
    for (const node of nodes) {
      if (node.kind === 'turn' && (turn === undefined || node.data.seq >= turn.seq)) turn = node.data
      if (node.kind === 'compaction' && (compaction === undefined || node.data.seq >= compaction.seq)) compaction = node.data
    }
    return compaction?.active === true ? compaction : turn
  }
  return {
    empty: undefined,
    replace(input) { turn = undefined; compaction = undefined; return apply(input.nodes) },
    apply: input => apply(input.upserts),
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap { 'pet-activity': PetLifecycle | undefined }
}
