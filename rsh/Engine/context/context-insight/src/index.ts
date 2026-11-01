/**
 * Native context insight: three durable projections and the `/context` command.
 *
 * Ported from the Cordis `dsh-context` plugin. That plugin shipped one prebuilt browser half bound
 * to six Cordis client services, so it could not load on a Native deployment; the durable analysis
 * was the part that carried the value, and it survives here as plain folds a stored Session can
 * replay without the Agent alive.
 *
 * @module @deepseek-ai/dsh-context-insight
 */

import type { NativeContext, NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { ActivityState } from './activity.ts'
import type { CompositionState } from './composition.ts'
import type { RequestHistoryState } from './requests.ts'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/native'
import type {} from '@deepseek-ai/dsh-session-projection/native'
import {
  activityStateSchema, applyActivityEvent, initialActivityState,
} from './activity.ts'
import {
  applyCompositionEvent, compositionStateSchema, initialCompositionState,
} from './composition.ts'
import {
  applyRequestHistoryEvent, initialRequestHistoryState, requestHistoryStateSchema,
} from './requests.ts'
import { formatContextReport } from './report.ts'

/** Projection key holding what this Session's context is made of. */
export const COMPOSITION_KEY = 'contextComposition'
/** Projection key holding one row per model request. */
export const REQUESTS_KEY = 'contextRequests'
/** Projection key holding per-day usage folded from the same log. */
export const ACTIVITY_KEY = 'contextActivity'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** What this Session's context is made of. */
    contextComposition: CompositionState
    /** One row per model request, for growth. */
    contextRequests: RequestHistoryState
    /** Per-day usage folded from the same log. */
    contextActivity: ActivityState
  }
}

/** The `/context` command name typed by a user. */
export const CONTEXT_COMMAND_NAME = 'context'
/** The one-line description a command surface shows for `/context`. */
export const CONTEXT_COMMAND_DESCRIPTION = "Show what this Session's context is made of"

/** Host plugin: the three folds, plus the command when a command service is composed. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-context-insight',
  targets: ['host'],
  requires: ['sessionProjections'],
  // The command service is optional: a headless deployment keeps the projections without a
  // slash command nobody can type.
  optional: ['commands'],
  provides: [],
  resolve(input) {
    if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length !== 0)) {
      throw new Error('context-insight: configuration must be an empty object')
    }
    return (context: NativeContext): void => {
      const projections = context.require('sessionProjections')

      context.effect(projections.register({
        key: COMPOSITION_KEY,
        stateVersion: 1,
        stateSchema: compositionStateSchema,
        init: () => initialCompositionState(),
        apply: (state, event) => applyCompositionEvent(state, event),
      }))

      context.effect(projections.register({
        key: REQUESTS_KEY,
        stateVersion: 1,
        stateSchema: requestHistoryStateSchema,
        init: () => initialRequestHistoryState(),
        apply: (state, event) => applyRequestHistoryEvent(state, event),
      }))

      context.effect(projections.register({
        key: ACTIVITY_KEY,
        stateVersion: 1,
        stateSchema: activityStateSchema,
        init: () => initialActivityState(),
        apply: (state, event) => applyActivityEvent(state, event),
      }))

      const commands = context.optional('commands')
      if (commands === undefined) return
      context.effect(commands.register({
        definitionId: CommandDefinitionId('context-insight'),
        name: CONTEXT_COMMAND_NAME,
        description: CONTEXT_COMMAND_DESCRIPTION,
        handler: (invocation) => {
          const session = invocation.owner.session
          return {
            kind: 'success',
            text: formatContextReport({
              composition: projections.stateOf(session, COMPOSITION_KEY) ?? initialCompositionState(),
              requests: projections.stateOf(session, REQUESTS_KEY) ?? initialRequestHistoryState(),
            }),
          }
        },
      }, context.scope))
    }
  },
}

export { formatContextReport } from './report.ts'
export type { CompositionCategory, CompositionRequest, CompositionState } from './composition.ts'
export type { ActivityDay, ActivityState } from './activity.ts'
export type { RequestHistoryState, RequestRow } from './requests.ts'
