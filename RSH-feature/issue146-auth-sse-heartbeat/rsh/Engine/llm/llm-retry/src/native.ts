/**
 * Native installer of the provider-routed retry policy over the selected model execution.
 * @module @deepseek-ai/dsh-llm-retry/native
 */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { Session } from '@deepseek-ai/dsh-session/native'
import type {} from '@deepseek-ai/dsh-native-model-execution/native'
import { assertEmptyRetryConfig, recoverWithRetry, retryStateKey, type RetryInternals, type RetryStateEntry } from './core.ts'
import type {} from './types.ts'

/** Retry chains of the step currently recovering in one Session. */
interface StepRetryState {
  readonly turn: number
  readonly step: number
  readonly entries: Map<string, RetryStateEntry>
}

/**
 * Build the native installer with deterministic hooks for tests.
 * @param internals - non-serializable timing hooks; production uses {@link plugin}.
 * @returns a Definition whose configuration must be empty because providers own retry policy.
 */
export function createNativeRetryPlugin(internals: RetryInternals = {}): NativePlugin {
  const random = internals.random ?? Math.random
  return {
    apiVersion: 1, name: '@deepseek-ai/dsh-llm-retry', targets: ['host'],
    requires: ['modelExecution'], provides: [],
    resolve(input) {
      assertEmptyRetryConfig(input)
      return (context) => {
        const execution = context.require('modelExecution')
        const lifetime = new AbortController()
        const active = new Set<Promise<unknown>>()
        // Chains reset when a Session moves to another step, matching the Cordis projection reset at step/start.
        const states = new WeakMap<Session, StepRetryState>()
        const stepState = (session: Session, turn: number, step: number): Map<string, RetryStateEntry> => {
          const current = states.get(session)
          if (current?.turn === turn && current.step === step) return current.entries
          const entries = new Map<string, RetryStateEntry>()
          states.set(session, { turn, step, entries })
          return entries
        }
        context.own(() => {
          lifetime.abort(new Error('llm-retry: native installer disposed'))
          return Promise.allSettled([...active]).then(() => undefined)
        })
        context.effect(execution.onRecovery((request, next) => {
          // A captured waterfall may still call a removed policy; lifetime closes it before delegation.
          if (lifetime.signal.aborted) return Promise.resolve(undefined)
          const entries = stepState(request.session, request.turn, request.step)
          const operation = recoverWithRetry({
            lifetime: lifetime.signal,
            random,
            previous: key => entries.get(key),
            async scheduled(data) {
              request.append(request.session.append('llm/retry', data))
              entries.set(retryStateKey(data.provider, data.policyKey), { retry: data.retry, retryId: data.retryId })
              await request.persist()
            },
            async started(data) {
              request.append(request.session.append('llm/retry-started', data))
              await request.persist()
            },
            warn: (message, error) => { console.warn(`${message}:`, error) },
          }, request, next)
          const tracked = operation.finally(() => active.delete(tracked))
          active.add(tracked)
          return tracked
        }))
      }
    },
  }
}

/** Install one retry policy over the selected model execution; providers own the policy values. */
export const plugin: NativePlugin = createNativeRetryPlugin()
