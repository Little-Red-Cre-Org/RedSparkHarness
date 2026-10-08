/**
 * Plan mode is logged per-agent collaboration state: while active, a
 * deployment-owned guidance section is included in each model request, and
 * `exit_plan_mode` presents the completed plan for user review, while the
 * `/plan off` command lets a user leave directly. Sandbox mode and approval
 * policy enforce restrictions independently and do not read or write plan
 * state.
 *
 * The `plan` projection folds the session log, so resume and fork restore the
 * state. User selections remain pending until the next accepted in-turn
 * pre-step. The service includes the selected state in the proposed step
 * assembly, then appends `plan/mode` from `agent/pre-step` only when the step
 * is accepted. Same-step request retries reuse their assembly.
 *
 * The exit tool remains registered while plan mode is inactive, so entering
 * or leaving plan mode changes only the prompt section, not the request tool
 * catalog.
 *
 * Agent Note:
 * - .agents/notes/implemented/simplification/2026-07-22-plan-specific-collaboration-state.md
 *
 * @module @deepseek-ai/dsh-plan-mode
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { CommandDefinitionId, CommandId } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { PlanProjection, PlanUnitState } from './types.ts'
import {
  EXIT_APPROVED_TEXT, EXIT_DESCRIPTION, EXIT_PLAN_ARGUMENT_DESCRIPTION, EXIT_PLAN_MODE, firstHeading,
  PLAN_COMMAND_DESCRIPTION, PLAN_COMMAND_HINT, PLAN_COMMAND_NAME, planCommandText, planSwitchText, resolveConfig,
  type PlanModeConfig,
} from './common.ts'
import { parsePlanCommand, PlanModeSelections, reviewPlanExit, type PlanSessionView } from './selection.ts'
export type * from './types.ts'
export { EXIT_PLAN_MODE, resolveConfig } from './common.ts'
export type { PlanModeConfig } from './common.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    planMode: PlanModeController
  }
}

const planUnitStateSchema: ZodType<PlanUnitState> = zod.object({
  active: zod.boolean(),
  wanted: zod.boolean().nullable(),
  running: zod.object({
    commandId: zod.string() as unknown as ZodType<CommandId>,
    wanted: zod.boolean(),
  }).strict().nullable(),
  activeAtLastHeader: zod.boolean().nullable(),
}).strict()

/** Wire payload schema of the `plan` projection. */
const planProjectionSchema: ZodType<PlanProjection> = zod.object({
  active: zod.boolean(),
  pending: zod.boolean(),
})

/** Projection of logged plan selections and committed mode. */
export const planProjectionDefinition = {
  key: 'plan',
  stateVersion: 3,
  stateSchema: planUnitStateSchema,
  init: () => ({ active: false, wanted: null, running: null, activeAtLastHeader: null }),
  apply: (state, event) => {
    if (event.type === 'command/run' && event.data.name === 'plan') {
      if (event.data.args === undefined) return state
      const wanted = event.data.args.trim() !== 'off'
      return { ...state, running: { commandId: event.data.commandId, wanted } }
    }
    if (event.type === 'command/done' && event.data.commandId === state.running?.commandId) {
      const wanted = event.data.kind === 'success' && state.running.wanted !== state.active
        ? state.running.wanted
        : null
      return { ...state, wanted, running: null }
    }
    if (event.type === 'plan/mode') {
      return { ...state, active: event.data.active, wanted: null }
    }
    if (event.type === 'request/header') {
      return { ...state, activeAtLastHeader: state.active }
    }
    return state
  },
  wire: {
    viewSchema: planProjectionSchema,
    view: (state) => {
      const wanted = state.running?.wanted ?? state.wanted
      return { active: state.active, pending: wanted !== null && wanted !== state.active }
    },
  },
} satisfies ProjectionDefinition<'plan', PlanUnitState>

/**
 * `ctx.planMode`: owns logged plan state, applies and narrates selected state at step start,
 * the `plan:policy` section, the `/plan` command, and the stable exit tool.
 * Client carriers expose the projection's cropped `{ active, pending }` view.
 * The selection state machine and the reviewed exit are the shared
 * framework-free core in `./selection.ts`; this class is the Cordis glue.
 */
export class PlanModeController extends Service {
  static inject = ['tools', 'systemPrompt', 'sessionProjections']

  /** Validated deployment-owned guidance. */
  private readonly section: string

  /** Shared selection state machine keyed by live session. */
  private readonly selections = new PlanModeSelections<Session>(new WeakMap(), planSwitchText)

  constructor(ctx: Context, config: PlanModeConfig = { section: '' }) {
    super(ctx, 'planMode')
    this.section = resolveConfig(config).section
    let disposed = false
    // Pre-step is outside Session.append publication, so it can append the
    // log-only mode event inside an open turn without re-entering the session.
    // A failed append remains pending for a later accepted in-turn pre-step,
    // and policy cannot block the step.
    ctx.on('agent/pre-step', async (
      { agent, signal },
      next,
    ): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted || this.selections.pending(agent.session) === undefined) return decision
      let narration
      try {
        narration = this.onBoundary(agent.session)
      } catch (error) {
        ctx.logger.warn('dsh-plan-mode: failed to append selected plan mode at step start: %o', error)
        return decision
      }
      return narration === undefined ? decision : { ...decision, messages: [...decision.messages, narration] }
    })
    ctx.effect(() => () => { disposed = true }, 'dsh-plan-mode: close service lifetime')

    ctx.systemPrompt.section({
      name: 'plan:policy',
      order: ctx.systemPrompt.getSectionOrder('PLAN_POLICY'),
      text: (context) => {
        if (context.agent === undefined) return ''
        const session = context.agent.session
        return this.selections.effectiveActive(session, this.view(session)) ? this.section : ''
      },
    })

    ctx.sessionProjections.register(planProjectionDefinition)

    // The command child activates only when a command registry is composed.
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        definitionId: brandString<CommandDefinitionId>('@deepseek-ai/dsh-plan-mode'),
        name: PLAN_COMMAND_NAME,
        description: PLAN_COMMAND_DESCRIPTION,
        input: { hint: PLAN_COMMAND_HINT, attachments: true },
        handler: ({ agent, rawInput, attachments }) => {
          const request = parsePlanCommand(rawInput, attachments)
          if (request.kind === 'error') return request
          const outcome = this.set(agent, request.active)
          if (request.steer !== undefined) {
            agent.steer(createUserMessage({ content: [...request.steer.content], source: { kind: 'user' } }))
          }
          return { kind: 'success', text: planCommandText(request.active, outcome, this.loggedActive(agent.session)) }
        },
      })
    })

    ctx.tools.register(defineTool({
      name: EXIT_PLAN_MODE,
      description: EXIT_DESCRIPTION,
      parameters: {
        plan: { type: 'string', required: true, description: EXIT_PLAN_ARGUMENT_DESCRIPTION },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            approved: { type: 'boolean', const: true, required: true },
          },
        },
        render: () => [{ type: 'text', text: EXIT_APPROVED_TEXT }],
      },
      execute: async (args, exec) => {
        const agent = exec.agent
        if (agent === undefined) throw new Error(`${EXIT_PLAN_MODE} requires a calling agent (no session to switch)`)
        const interaction = ctx.get('userQuestions')
        await reviewPlanExit(args.plan, {
          active: this.loggedActive(agent.session),
          ask: interaction === undefined
            ? undefined
            : question => interaction.ask({ questions: [question], agent, signal: exec.signal }),
          dismissed: cause => cause instanceof UserQuestionError && cause.code === 'ASK_CANCELLED',
          reloaded: () => disposed,
        })
        this.selections.approveExit(agent.session)
        return { approved: true }
      },
      presentCall: args => ({
        card: 'generic',
        title: firstHeading(args.plan) ?? 'Plan',
        kind: 'other',
        content: [{ type: 'text', text: args.plan }],
      }),
      presentResult: (_args, result) => ({
        card: 'generic',
        title: 'Plan review',
        content: result.content,
      }),
    }))
  }

  private loggedActive(session: Session): boolean {
    return this.planState(session).active
  }

  /** Session reads and append supplied to the shared selection core. */
  private view(session: Session): PlanSessionView {
    return {
      loggedActive: () => this.loggedActive(session),
      toldActive: () => this.planState(session).activeAtLastHeader ?? undefined,
      hasOpenTurn: () => this.hasOpenTurn(session),
      appendMode: (active) => { session.append('plan/mode', { active }) },
    }
  }

  /**
   * Append one pending selection before the next request assembly.
   * @returns narration for a user selection, computed before the append.
   */
  private onBoundary(session: Session): UserMessage | undefined {
    return this.selections.applyBoundary(session, this.view(session))
  }

  private hasOpenTurn(session: Session): boolean {
    const state = this.ctx.sessionProjections.stateOf(session, 'turnBoundary')
    if (state === undefined) throw new Error('plan-mode requires the turnBoundary session projection')
    return state.openTurnStartSeq !== null
  }

  /** Read the required plan projection state or fail at the first service access. */
  private planState(session: Session): PlanUnitState {
    const state = this.ctx.sessionProjections.stateOf(session, 'plan')
    if (state === undefined) throw new Error('plan-mode requires the plan session projection')
    return state
  }

  /**
   * Read the logged plan state and any selected state awaiting the next
   * accepted in-turn pre-step.
   *
   * @param agent The agent to read.
   * @returns Current logged state plus a pending selection, when present.
   */
  get(agent: Agent): { active: boolean; pending?: boolean } {
    return this.selections.get(agent.session, this.view(agent.session))
  }

  /**
   * Select whether plan mode should be active. Between turns the method
   * appends the change immediately because no in-turn pre-step will run until
   * another prompt starts a turn. The open-turn fold is the idle signal:
   * agent status stays `running` through post-turn checkpointing, when no
   * further in-turn pre-step runs. During an open turn the selection remains
   * pending until the next accepted in-turn pre-step. Repeated selection of
   * the current or already-pending state is a no-op.
   *
   * @param agent The agent to switch.
   * @param active Whether plan mode should be active.
   * @returns what happened: `committed` (logged now), `queued` (awaiting the
   * next accepted in-turn pre-step), `cancelled` (an opposite pending selection
   * was cleared; the logged state already matches), or `noop` (already in that
   * state).
   */
  set(agent: Agent, active: boolean): 'committed' | 'queued' | 'cancelled' | 'noop' {
    const selection = this.selections.select(agent.session, this.view(agent.session), active)
    if (selection.narration !== undefined) agent.inject(selection.narration)
    return selection.outcome
  }
}

export default PlanModeController
