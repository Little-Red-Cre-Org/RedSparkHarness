/**
 * Native plan mode: the shared selection state machine and reviewed exit from
 * `./selection.ts`, wired to the native sole Session writer. The native system
 * prompt is immutable for a session, so guidance travels as a plugin-sourced
 * user notice in the durable inbox instead of a prompt section: entering plan
 * mode narrates the switch together with the deployment guidance. Selections
 * made during an open turn are applied at the next accepted step, the native
 * counterpart of the framework pre-step. A selection without a notice to
 * deliver commits in the step-admission hook; a narrated one commits only when
 * its notice's `user/message` is durable, because admission is in memory and
 * the step persists admitted input after the hook returns.
 *
 * Agent Note:
 * - .agents/notes/implemented/architecture/2026-10-08-native-session-title-and-plan-mode.md
 *
 * @module @deepseek-ai/dsh-plan-mode/native
 */

import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/native'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import type { MessageId } from '@deepseek-ai/dsh-llm/native'
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type {} from '@deepseek-ai/dsh-native-session-execution/native'
import type { SessionEvent } from '@deepseek-ai/dsh-session/native'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions/native'
import type {} from './common.ts'
import {
  EXIT_APPROVED_TEXT, EXIT_DESCRIPTION, EXIT_PLAN_ARGUMENT_DESCRIPTION, EXIT_PLAN_MODE, PLAN_COMMAND_DESCRIPTION,
  PLAN_COMMAND_HINT, PLAN_COMMAND_NAME, PLAN_NOTICE_PLUGIN, planCommandText, planSwitchText, resolveConfig,
  type PlanModeConfig,
} from './common.ts'
import { parsePlanCommand, PlanModeSelections, reviewPlanExit, type PlanSessionView } from './selection.ts'

/** Step-admission order: outermost, so the hook sees every downstream decision. */
const PLAN_ADMISSION_ORDER = 100

/** Folded plan facts of one attached session. */
interface NativePlanState {
  /** Last logged plan mode. */
  active: boolean
  /** What the model was last told: the mode at the last accepted step, or the mode a durable notice announced. */
  told: boolean | undefined
  /** Whether a turn is open. */
  turnOpen: boolean
  /** Plan notice still queued for admission and the mode it announces. */
  notice: { readonly id: MessageId; readonly active: boolean } | undefined
}

/** Read-only view of one agent's plan mode. */
export interface NativePlanModeState {
  /** Agent whose session is reported. */
  readonly agent: NativeAgent
  /** Last logged plan mode. */
  readonly active: boolean
  /** Selected mode awaiting the next accepted step, when one is pending. */
  readonly pending?: boolean
}

/** Native plan-mode capability: observe logged and pending state without selecting it. */
export interface NativePlanMode {
  /** Read the state of every attached agent. */
  states(): readonly NativePlanModeState[]
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** Logged plan mode, its guidance notices, the `/plan` command, and the exit tool. */
    planMode: NativePlanMode
  }
}

/**
 * Apply one durable event to an attached plan state.
 * @param state - mutable state of one attached session.
 * @param event - accepted durable event.
 */
function applyPlanEvent(state: NativePlanState, event: SessionEvent): void {
  if (event.type === 'plan/mode') state.active = event.data.active
  else if (event.type === 'turn/start') state.turnOpen = true
  else if (event.type === 'turn/end') state.turnOpen = false
  else if (event.type === 'step/start') state.told = state.active
  else if (event.type === 'user/message' && state.notice !== undefined && event.data.id === state.notice.id) {
    state.told = state.notice.active
    state.notice = undefined
  }
}

/** Native plan-mode plugin over the selected tool registry and active session owners. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-plan-mode',
  targets: ['host'],
  requires: ['tools', 'activeSessions'],
  optional: ['commands', 'userQuestions'],
  provides: ['planMode'],
  resolve(input: unknown) {
    const { section } = resolveConfig((input ?? {}) as PlanModeConfig)
    const enterText = `${planSwitchText(true)}\n\n${section}`
    return async (context) => {
      const tools = context.require('tools')
      const sessions = context.require('activeSessions')
      const commands = context.optional('commands')
      const questions = context.optional('userQuestions')
      // Pending selections outlive one owner attachment, so they are keyed by Session id.
      const selections = new PlanModeSelections<string>(new Map(), active => active ? enterText : planSwitchText(false))
      const states = new Map<NativeAgent, {
        readonly owner: NativeActiveSessionOwner
        readonly state: NativePlanState
        readonly releases: readonly (() => void | Promise<void>)[]
      }>()

      const view = (owner: NativeActiveSessionOwner, state: NativePlanState): PlanSessionView => ({
        loggedActive: () => state.active,
        // Nothing told yet means the immutable system prompt carried no guidance.
        toldActive: () => state.told ?? false,
        hasOpenTurn: () => state.turnOpen,
        appendMode: (active) => {
          owner.append('plan/mode', { active })
          state.active = active
        },
      })

      /**
       * Keep at most one queued plan notice, announcing the mode the model
       * must learn at its next admitted step; withdraw a stale one.
       */
      const reconcile = async (owner: NativeActiveSessionOwner, state: NativePlanState, signal: AbortSignal): Promise<void> => {
        const sessionView = view(owner, state)
        const intent = selections.pending(owner.session.id)
        const desired = intent === undefined ? state.active : intent.narrate ? intent.active : undefined
        const notice = desired === undefined ? undefined : selections.narration(sessionView, desired)
        const queued = state.notice
        if (queued !== undefined && !owner.messages('next-step').some(message => message.id === queued.id)) state.notice = undefined
        if (state.notice !== undefined && notice !== undefined && state.notice.active === desired) return
        if (state.notice !== undefined) {
          await owner.remove([state.notice.id], 'next-step', signal)
          state.notice = undefined
        }
        if (notice === undefined || desired === undefined) return
        state.notice = { id: notice.id, active: desired }
        await owner.enqueue(notice, 'next-step', false, signal)
      }

      const attach = async (owner: NativeActiveSessionOwner): Promise<void> => {
        const state: NativePlanState = { active: false, told: undefined, turnOpen: false, notice: undefined }
        const buffered: SessionEvent[] = []
        let ready = false
        const stop = owner.onEvent((event) => {
          if (!ready) { buffered.push(event); return }
          const notice = state.notice
          applyPlanEvent(state, event)
          if (notice === undefined || event.type !== 'user/message' || event.data.id !== notice.id) return
          // The notice is now durable in history, the first point at which a
          // narrated selection may commit. The append joins the same step.
          try {
            selections.commitNarrated(owner.session.id, view(owner, state), notice.active)
          } catch (error: unknown) {
            console.warn(`dsh-plan-mode: failed to append selected plan mode after its notice; the selection stays pending: ${String(error)}`)
          }
        })
        try {
          const events = await owner.readEvents()
          for (const event of events) applyPlanEvent(state, event)
          const watermark = events.at(-1)?.seq
          for (const event of buffered) {
            if (watermark === undefined || event.seq > watermark) applyPlanEvent(state, event)
          }
        } catch (failure: unknown) { stop(); throw failure }
        // A durable inbox may still hold a notice queued by an earlier attachment.
        const queued = owner.messages('next-step').findLast(message =>
          message.source.kind === 'plugin' && message.source.plugin === PLAN_NOTICE_PLUGIN)
        if (queued !== undefined) {
          const text = queued.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('')
          state.notice = { id: queued.id, active: text.startsWith(planSwitchText(true)) }
        }
        ready = true
        // Selections made during an open turn apply at the next accepted step,
        // after every downstream admission decision; the narration is already queued.
        const admission = owner.beforeStep(async (step, next) => {
          const key = owner.session.id
          const selected = selections.pending(key)
          const notice = state.notice
          const decision = await next()
          if (decision.kind === 'reject' || step.signal.aborted || selected === undefined
            || selections.pending(key) !== selected || state.notice !== notice) return decision
          // Admission is only in memory: a narrated selection waits for its
          // notice's durable `user/message` (the event observer above), so a
          // notice that fails to persist or is rejected after this hook keeps
          // the selection pending and its guidance queued.
          if (selections.awaitsNarration(key, view(owner, state))) return decision
          try {
            selections.applyBoundary(key, view(owner, state))
          } catch (error: unknown) {
            console.warn(`dsh-plan-mode: failed to append selected plan mode at step start; the selection stays pending: ${String(error)}`)
          }
          return decision
        }, PLAN_ADMISSION_ORDER)
        // A notice withdrawn after admission is not retried by the step that
        // dropped it; re-queue the guidance of a still-pending selection once
        // the turn settles so the next accepted step delivers it.
        const idle = owner.onIdle(async () => {
          if (selections.pending(owner.session.id) === undefined || !owner.writerAvailable) return
          try {
            await reconcile(owner, state, context.signal)
          } catch (error: unknown) {
            console.warn(`dsh-plan-mode: failed to re-queue the plan notice of a pending selection: ${String(error)}`)
          }
        })
        states.set(owner.agent, { owner, state, releases: [stop, admission, idle] })
      }
      const detach = async (agent: NativeAgent): Promise<void> => {
        const entry = states.get(agent)
        if (entry === undefined) return
        states.delete(agent)
        for (const release of entry.releases) await release()
      }
      context.effect(sessions.onAttached(attach))
      context.effect(sessions.onDetached(async (owner) => { await detach(owner.agent) }))
      context.own(async () => {
        for (const agent of [...states.keys()]) await detach(agent)
      })
      for (const owner of sessions.owners()) await attach(owner)

      context.provide('planMode', {
        states: () => [...states].map(([agent, { owner, state }]) => ({
          agent, ...selections.get(owner.session.id, view(owner, state)),
        })),
      } satisfies NativePlanMode)

      context.effect(tools.registerValueTool({
        schema: {
          name: EXIT_PLAN_MODE,
          description: EXIT_DESCRIPTION,
          parameters: {
            type: 'object', additionalProperties: false,
            properties: { plan: { type: 'string', description: EXIT_PLAN_ARGUMENT_DESCRIPTION } },
            required: ['plan'],
          },
        },
        output: {
          schema: {
            type: 'object', additionalProperties: false,
            properties: { approved: { type: 'boolean', const: true } }, required: ['approved'],
          },
          render: () => ({ content: [{ type: 'text', text: EXIT_APPROVED_TEXT }], isError: false }),
        },
        execute: async (call) => {
          const entry = states.get(call.agent)
          const owner = sessions.owner(call.agent, call.session)
          if (entry === undefined || owner !== entry.owner) throw new Error(`${EXIT_PLAN_MODE} requires the session's active owner`)
          await reviewPlanExit((call.arguments as { plan?: unknown }).plan, {
            active: entry.state.active,
            ask: questions === undefined
              ? undefined
              : question => questions.ask({ agent: call.agent, session: call.session, questions: [question], signal: call.signal }),
            dismissed: cause => cause instanceof UserQuestionError && cause.code === 'ASK_CANCELLED',
            reloaded: () => context.signal.aborted,
          })
          selections.approveExit(owner.session.id)
          await reconcile(owner, entry.state, call.signal)
          return { approved: true }
        },
      }, context.scope))

      if (commands !== undefined) {
        context.effect(commands.register({
          definitionId: CommandDefinitionId('@deepseek-ai/dsh-plan-mode'),
          name: PLAN_COMMAND_NAME,
          description: PLAN_COMMAND_DESCRIPTION,
          input: { hint: PLAN_COMMAND_HINT, attachments: true },
          handler: async (invocation) => {
            const request = parsePlanCommand(invocation.rawInput, invocation.attachments)
            if (request.kind === 'error') return request
            const entry = states.get(invocation.agent)
            if (entry === undefined || entry.owner !== invocation.owner) {
              return { kind: 'error', text: 'Plan mode is not attached to this session.' }
            }
            const owner = invocation.owner
            const { outcome } = selections.select(owner.session.id, view(owner, entry.state), request.active)
            if (outcome === 'committed') await owner.flush()
            await reconcile(owner, entry.state, invocation.signal)
            if (request.steer !== undefined) {
              // Steering for the nearest step, after the plan notice. An idle
              // session admits it at the next turn's first step.
              await owner.enqueue(createUserMessage({ content: [...request.steer.content], source: { kind: 'user' } }),
                'next-step', false, invocation.signal)
            }
            return { kind: 'success', text: planCommandText(request.active, outcome, entry.state.active) }
          },
        }, context.scope))
      }
    }
  },
}
