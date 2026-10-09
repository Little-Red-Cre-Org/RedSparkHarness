/**
 * Framework-free plan-mode behavior shared by the Cordis service and the
 * native Consumer: the selection state machine (pending user selections, the
 * silent approved exit, and step-boundary application), the user-switch
 * narration rule, `/plan` input interpretation, and the reviewed exit. Each
 * runtime supplies only its own session reads, durable append, and delivery.
 *
 * @module @deepseek-ai/dsh-plan-mode/selection
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import type { UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/protocol'
import {
  assertPlanApproved, assertPlanHeading, EXIT_PLAN_MODE, NO_REVIEW_CHANNEL_MESSAGE, PLAN_NOTICE_PLUGIN,
  PLAN_OFF_ATTACHMENTS_TEXT, planReviewQuestion, REVIEW_DISMISSED_MESSAGE, type PlanSelectionOutcome,
} from './common.ts'

/** Runtime-owned reads and the durable mode append of one session. */
export interface PlanSessionView {
  /** Last logged plan mode. */
  loggedActive(): boolean
  /** Mode the model was last told about, or `undefined` when it has been told nothing. */
  toldActive(): boolean | undefined
  /** Whether a turn is open, so a selection must wait for the next accepted step. */
  hasOpenTurn(): boolean
  /**
   * Append one `plan/mode` event through the session's sole writer.
   * @param active - committed mode.
   */
  appendMode(active: boolean): void
}

/** One selection awaiting the next accepted in-turn step. */
export interface PlanIntent {
  /** Selected mode. */
  readonly active: boolean
  /** True for user selections; false for the approved exit, whose tool result already narrates it. */
  readonly narrate: boolean
}

/** Keyed intent storage: a WeakMap for live session objects, a Map for session ids. */
export interface PlanIntentStore<K> {
  get(key: K): PlanIntent | undefined
  set(key: K, intent: PlanIntent): unknown
  delete(key: K): unknown
}

/** Result of one selection. */
export interface PlanSelection {
  /** What happened. */
  readonly outcome: PlanSelectionOutcome
  /** Narration to deliver now for an immediate commit. */
  readonly narration?: UserMessage
}

/** Shared plan-mode selection state machine. */
export class PlanModeSelections<K> {
  /**
   * @param intents - storage for selections awaiting the next accepted step.
   * @param noticeText - narration text for a user switch to the given mode.
   */
  constructor(private readonly intents: PlanIntentStore<K>, private readonly noticeText: (active: boolean) => string) {}

  /**
   * Selection awaiting the next accepted in-turn step, if any.
   * @param key - session key.
   * @returns the pending intent, or undefined.
   */
  pending(key: K): PlanIntent | undefined { return this.intents.get(key) }

  /**
   * Mode used for request assembly: a pending selection wins over the logged mode.
   * @param key - session key.
   * @param view - session reads.
   * @returns whether plan guidance applies.
   */
  effectiveActive(key: K, view: PlanSessionView): boolean {
    return this.intents.get(key)?.active ?? view.loggedActive()
  }

  /**
   * Read the logged state and any selection awaiting the next accepted step.
   * @param key - session key.
   * @param view - session reads.
   * @returns logged mode plus a pending selection, when present.
   */
  get(key: K, view: PlanSessionView): { active: boolean; pending?: boolean } {
    const active = view.loggedActive()
    const pending = this.intents.get(key)
    return pending === undefined ? { active } : { active, pending: pending.active }
  }

  /**
   * Select whether plan mode should be active. Between turns the change is
   * appended immediately because no in-turn step will run until another
   * prompt starts a turn. During an open turn the selection remains pending
   * until the next accepted in-turn step. Repeated selection of the current
   * or already-pending state is a no-op.
   * @param key - session key.
   * @param view - session reads and append.
   * @param active - selected mode.
   * @returns `committed` (logged now, with any narration to deliver), `queued`
   * (awaiting the next accepted step), `cancelled` (an opposite pending
   * selection was cleared), or `noop`.
   */
  select(key: K, view: PlanSessionView, active: boolean): PlanSelection {
    const pending = this.intents.get(key)
    const target = pending?.active ?? view.loggedActive()
    if (active === target) return { outcome: 'noop' }
    if (view.hasOpenTurn()) {
      this.intents.set(key, { active, narrate: true })
      return { outcome: view.loggedActive() === active ? 'cancelled' : 'queued' }
    }
    // No open turn: commit now. Delete only after append succeeds so a
    // failed durable write leaves the selection retryable, not dropped.
    if (active === view.loggedActive()) {
      this.intents.delete(key)
      return { outcome: 'cancelled' }
    }
    view.appendMode(active)
    this.intents.delete(key)
    const narration = this.narration(view, active)
    return narration === undefined ? { outcome: 'committed' } : { outcome: 'committed', narration }
  }

  /**
   * Record an approved exit. The silent selection is applied at the next
   * accepted in-turn step, so guidance stays for the rest of the tool batch.
   * @param key - session key.
   */
  approveExit(key: K): void { this.intents.set(key, { active: false, narrate: false }) }

  /**
   * Apply a pending selection at an accepted in-turn step boundary. A runtime
   * whose narration is a queued durable message applies only selections for
   * which `awaitsNarration` is false and commits the others with `commitNarrated`.
   * @param key - session key.
   * @param view - session reads and append.
   * @returns narration for a user selection, computed before the append.
   * @throws when the durable append fails; the selection stays pending.
   */
  applyBoundary(key: K, view: PlanSessionView): UserMessage | undefined {
    const pending = this.intents.get(key)
    if (pending === undefined) return undefined
    const narration = pending.narrate ? this.narration(view, pending.active) : undefined
    if (pending.active !== view.loggedActive()) view.appendMode(pending.active)
    // Delete only after append succeeds so a later accepted step can retry a failed write.
    this.intents.delete(key)
    return narration
  }

  /**
   * Whether the pending selection must wait for its narration to become
   * durable before it may commit. A runtime that delivers guidance as a
   * queued durable message must not apply such a selection at the step
   * boundary: admission is only in memory, and committing first would let a
   * failed or rejected notice write record the new mode as told while the
   * guidance never reached history.
   * @param key - session key.
   * @param view - session reads.
   * @returns true when a narrated selection still has a notice to deliver.
   */
  awaitsNarration(key: K, view: PlanSessionView): boolean {
    const pending = this.intents.get(key)
    return pending !== undefined && pending.narrate && this.narration(view, pending.active) !== undefined
  }

  /**
   * Commit a narrated selection once its notice is durable in session history.
   * The runtime calls this when it observes the notice's own durable event,
   * never at admission, so a notice that fails to persist or is rejected after
   * admission leaves the selection pending and its guidance retryable.
   * @param key - session key.
   * @param view - session reads and append.
   * @param announced - mode the durable notice announced.
   * @returns whether a pending selection was committed.
   * @throws when the durable append fails; the selection stays pending.
   */
  commitNarrated(key: K, view: PlanSessionView, announced: boolean): boolean {
    const pending = this.intents.get(key)
    if (pending === undefined || !pending.narrate || pending.active !== announced) return false
    if (pending.active !== view.loggedActive()) view.appendMode(pending.active)
    // Delete only after append succeeds so a later accepted step can retry a failed write.
    this.intents.delete(key)
    return true
  }

  /**
   * Build a user-switch notice when the model was last told about the other mode.
   * @param view - session reads.
   * @param target - selected mode.
   * @returns the plugin-sourced notice, or `undefined` when no narration is due.
   */
  narration(view: PlanSessionView, target: boolean): UserMessage | undefined {
    const told = view.toldActive()
    if (told === undefined || told === target) return undefined
    const text = this.noticeText(target)
    return createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: PLAN_NOTICE_PLUGIN, form: 'notice', summary: text },
    })
  }
}

/** Interpreted `/plan` input. */
export type PlanCommandRequest<A> =
  | { readonly kind: 'error'; readonly text: string }
  | { readonly kind: 'select'; readonly active: boolean; readonly steer?: { readonly content: readonly (A | { type: 'text'; text: string })[] } }

/**
 * Interpret `/plan`, `/plan off`, and `/plan <message>` with optional attachments.
 * @param rawInput - text after the command name.
 * @param attachments - attached content parts.
 * @returns the selection plus steering content for the nearest step, or an input error.
 */
export function parsePlanCommand<A>(rawInput: string, attachments: readonly A[]): PlanCommandRequest<A> {
  const message = rawInput.trim()
  if (message === 'off' && attachments.length > 0) return { kind: 'error', text: PLAN_OFF_ATTACHMENTS_TEXT }
  if (message === 'off') return { kind: 'select', active: false }
  if (message === '' && attachments.length === 0) return { kind: 'select', active: true }
  return {
    kind: 'select', active: true,
    steer: { content: [...attachments, ...(message === '' ? [] : [{ type: 'text' as const, text: message }])] },
  }
}

/** Runtime capabilities used by one exit review. */
export interface PlanExitReview {
  /** Whether the calling session is in plan mode. */
  readonly active: boolean
  /** Present the review question, or `undefined` when no interactive channel exists. */
  readonly ask: ((question: AskUserQuestionItem) => Promise<AskUserQuestionAnswer>) | undefined
  /** Whether a channel failure is the user dismissing the review to speak instead. */
  readonly dismissed: (cause: unknown) => boolean
  /** Whether the owning service was unloaded while the review was open. */
  readonly reloaded: () => boolean
}

/**
 * Validate an exit request, present it for review, and require an exact approval.
 * @param plan - plan markdown supplied by the model.
 * @param review - runtime capabilities.
 * @throws a model-facing error for every outcome except approval.
 */
export async function reviewPlanExit(plan: unknown, review: PlanExitReview): Promise<void> {
  if (!review.active) throw new Error(`${EXIT_PLAN_MODE} is only available in plan mode`)
  if (typeof plan !== 'string') throw new Error(`${EXIT_PLAN_MODE} requires a string plan`)
  assertPlanHeading(plan)
  if (review.ask === undefined) throw new Error(NO_REVIEW_CHANNEL_MESSAGE)
  const answer = await review.ask(planReviewQuestion(plan)).catch((cause: unknown) => {
    // A dismissed review is not a failed one: the user took the turn back to
    // say something the two options do not cover. An abort keeps its own message.
    if (review.dismissed(cause)) throw new Error(REVIEW_DISMISSED_MESSAGE)
    throw cause
  })
  // A review may outlive the service. Without its boundary listener an
  // approved selection could never be appended, so fail and keep planning.
  if (review.reloaded()) {
    throw new Error('the plan-mode service was reloaded while the plan was under review; present the plan again')
  }
  assertPlanApproved(answer)
}
