/** Canonical JSONL generation names and their physical compression suffixes. */

import { parseSessionFormatLogFilename, sessionFormatLogFilename } from '@deepseek-ai/dsh-session-format'

/** Physical encoding selected for JSONL session artifacts. */
export type JsonlCompression = 'zstd' | 'none'

/**
 * Return the artifact suffix for one physical encoding.
 * @param compression - configured JSONL artifact encoding.
 * @returns `.jsonl.zstd` for Zstandard or `.jsonl` for plaintext.
 */
export function logSuffix(compression: JsonlCompression): '.jsonl.zstd' | '.jsonl' {
  return `.jsonl${compressionSuffix(compression)}`
}

function compressionSuffix(compression: JsonlCompression): '.zstd' | '' {
  return compression === 'zstd' ? '.zstd' : ''
}

/**
 * Return the canonical filename for one immutable Session format generation.
 * Version zero retains the original suffix-only name; every later generation
 * carries a lowercase numeric `vN` component.
 * @param version - non-negative safe Session format version.
 * @param compression - configured JSONL artifact encoding.
 * @returns the generation filename inside one Session directory.
 */
export function generationLogFilename(version: number, compression: JsonlCompression): string {
  return `${sessionFormatLogFilename(version)}${compressionSuffix(compression)}`
}

/**
 * Parse one canonical generation filename for the selected physical encoding.
 * Noncanonical, temporary, uppercase, leading-zero, and version-zero-tagged names do
 * not identify committed generations.
 * @param filename - one entry from a Session directory.
 * @param compression - configured JSONL artifact encoding.
 * @returns its format version, or `undefined` when the name is not canonical.
 */
export function parseGenerationLogFilename(
  filename: string,
  compression: JsonlCompression,
): number | undefined {
  const suffix = compressionSuffix(compression)
  if (!filename.endsWith(suffix)) return undefined
  return parseSessionFormatLogFilename(filename.slice(0, filename.length - suffix.length))
}
