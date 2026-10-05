/** Profile settings validated before terminal or execution resources are acquired. */
import { z } from 'zod'
import { resolveNativeHeadlessConfig, type Config as TurnConfig } from '@deepseek-ai/dsh-native-headless/native'

/** Explicit terminal appearance and limits alongside shared native turn settings. */
export interface Config extends TurnConfig {
  readonly locale: 'en' | 'zh'
  readonly background: string
  readonly maxQueuedInputs: number
  readonly maxHistoryEvents: number
  readonly maxTranscriptEvents: number
  readonly maxStreamChunks: number
}
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const terminalSettings = z.looseObject({
  locale: z.enum(['en', 'zh']), background: z.string().regex(/^#[0-9a-f]{6}$/i),
  maxQueuedInputs: positive, maxHistoryEvents: positive, maxTranscriptEvents: positive, maxStreamChunks: positive,
})

/** Validate terminal settings and resolve the shared executor configuration.
 * @param input - explicit native profile configuration.
 * @returns resolved terminal and turn settings.
 */
export function resolveNativeTuiConfig(input: unknown): Config {
  const { locale, background, maxQueuedInputs, maxHistoryEvents, maxTranscriptEvents, maxStreamChunks, ...turn }
    = terminalSettings.parse(input)
  return { ...resolveNativeHeadlessConfig(turn), locale, background,
    maxQueuedInputs, maxHistoryEvents, maxTranscriptEvents, maxStreamChunks }
}

const terminalArgs = z.union([z.tuple([]), z.tuple([z.literal('--resume'), z.string().regex(/\S/)])])

/** Resolve explicit new-conversation or resume arguments.
 * @param args - terminal argv from the supported launcher.
 * @returns validated arguments without opening a Session.
 */
export function resolveNativeTuiArgs(args: readonly string[]): [] | ['--resume', string] { return terminalArgs.parse(args) }
