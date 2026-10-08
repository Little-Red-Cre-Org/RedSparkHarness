/**
 * Native All-human-messages model provider for the selected `sessionTitles` service.
 * The durable provider id matches the Cordis plugin name.
 *
 * Agent Note:
 * - .agents/notes/implemented/architecture/2026-10-08-native-session-title-and-plan-mode.md
 *
 * @module @deepseek-ai/dsh-session-title-all-prompts-llm/native
 */

import { nativeSessionTitleLlmPlugin, selectAllPrompts } from '@deepseek-ai/dsh-session-title-llm/native'

/** Native provider plugin; configuration is the shared required title-model policy. */
export const plugin = nativeSessionTitleLlmPlugin({
  name: '@deepseek-ai/dsh-session-title-all-prompts-llm',
  providerId: 'session-title-all-prompts-llm',
  automatic: 'all-prompts',
  selectMessages: selectAllPrompts,
})
