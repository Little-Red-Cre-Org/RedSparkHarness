import z from '@deepseek-ai/schemastery'

/** @module @deepseek-ai/dsh-tool-terminal/config */

/** Default cap for one complete model-facing terminal result. */
export const DEFAULT_MAX_RESULT_BYTES = 256 * 1024
/** Smallest cap that preserves every counter-backed PTY and job id in its creation acknowledgement. */
export const MIN_MAX_RESULT_BYTES = 64

/** Model-facing terminal tool configuration. */
export interface Config {
  /** Expose `run_in_background` and accept background sends (default true). */
  enableRunInBackground?: boolean
  /** Maximum UTF-8 bytes in one complete terminal or task-output result. */
  maxResultBytes?: number
}

/** Schemastery configuration for the terminal tool consumer. */
export const Config: z<Config> = z.object({
  enableRunInBackground: z.boolean().default(true),
  maxResultBytes: z.number().step(1).min(MIN_MAX_RESULT_BYTES).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RESULT_BYTES),
})
