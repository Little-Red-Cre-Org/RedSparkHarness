/**
 * Native face of the shared model-backed title policy: configuration
 * validation, message selection, and one framework-free generation over an
 * injected model stream and durable pre-dispatch record.
 *
 * Agent Note:
 * - .agents/notes/implemented/architecture/2026-10-08-native-session-title-and-plan-mode.md
 *
 * @module @deepseek-ai/dsh-session-title-llm/native
 */

import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-native-model-execution/native'
import { SessionTitleProviderId, type SessionTitleAutomaticMode } from '@deepseek-ai/dsh-session-title/native'
import {
  generateSessionTitle,
  resolveSessionTitleLlmConfig,
  type SessionTitleLlmConfig,
  type SessionTitleLlmMessageSelector,
} from './core.ts'

export {
  generateSessionTitle,
  resolveSessionTitleLlmConfig,
  selectAllPrompts,
  selectFirstPrompt,
  SESSION_TITLE_TIMEOUT_CODE,
} from './core.ts'
export type {
  ResolvedSessionTitleLlmConfig,
  SessionTitleLlmConfig,
  SessionTitleLlmHost,
  SessionTitleLlmMessageSelector,
  SessionTitleLlmRequest,
  SessionTitleLlmRequestEventData,
  SessionTitleLlmResult,
} from './core.ts'

/** Identity and cadence of one native model-backed title provider. */
export interface NativeSessionTitleLlmProviderSpec {
  /** Native plugin name. */
  readonly name: string
  /** Durable provider id recorded with accepted titles. */
  readonly providerId: string
  /** Automatic generation cadence. */
  readonly automatic: SessionTitleAutomaticMode
  /** Exact source-message selection for one revision. */
  readonly selectMessages: SessionTitleLlmMessageSelector
}

/**
 * Build one native model-backed title provider plugin.
 * @param spec - plugin name, durable provider id, cadence, and selection.
 * @returns a host plugin registering with the selected title service.
 */
export function nativeSessionTitleLlmPlugin(spec: NativeSessionTitleLlmProviderSpec): NativePlugin {
  return {
    apiVersion: 1,
    name: spec.name,
    targets: ['host'],
    requires: ['sessionTitles', 'model'],
    provides: [],
    resolve(input) {
      const config = resolveSessionTitleLlmConfig(input as SessionTitleLlmConfig)
      const id = SessionTitleProviderId(spec.providerId)
      return (context) => {
        const titles = context.require('sessionTitles')
        const model = context.require('model')
        context.effect(titles.register({
          id,
          automatic: spec.automatic,
          generate: request => generateSessionTitle({
            stream: options => model.stream(options),
            record: data => request.appendEvent('session/title-llm-request', data),
          }, config, {
            sessionId: request.session.id,
            ...request.route === undefined ? {} : { route: request.route },
            signal: request.signal,
          }, spec.selectMessages(request.messages), id),
        }))
      }
    },
  }
}
