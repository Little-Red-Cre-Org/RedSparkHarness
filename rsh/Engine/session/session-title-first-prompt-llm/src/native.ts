/**
 * Native First-human-message model provider for the selected `sessionTitles` service.
 * The durable provider id matches the Cordis plugin name.
 *
 * Agent Note:
 * - .agents/notes/implemented/architecture/2026-10-08-native-session-title-and-plan-mode.md
 *
 * @module @redspark/rsh-session-title-first-prompt-llm/native
 */

import { nativeSessionTitleLlmPlugin, selectFirstPrompt } from '@redspark/rsh-session-title-llm/native'

/** Native provider plugin; configuration is the shared required title-model policy. */
export const plugin = nativeSessionTitleLlmPlugin({
  name: '@redspark/rsh-session-title-first-prompt-llm',
  providerId: 'session-title-first-prompt-llm',
  automatic: 'first-prompt',
  selectMessages: selectFirstPrompt,
})
