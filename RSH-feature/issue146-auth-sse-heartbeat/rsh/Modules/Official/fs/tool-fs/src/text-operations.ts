/** Shared validation and model-facing text for legacy and native filesystem tools. */
import type { FsWriteOutcome } from '@deepseek-ai/dsh-fs/native'

/** Default and maximum number of lines returned by one read call. */
export const READ_LIMIT = 2000

/** Files at or above this size stream instead of loading whole into memory. */
export const STREAM_MIN_SIZE = 10 * 1024 * 1024

/** Model guidance shared by both file-tool entries when read is visible. */
export const READ_GUIDANCE = 'Use the read tool — not shell commands like cat — to inspect text files. Results include line numbers. Use offset and limit to continue reading large files.'

/** Model guidance shared by both file-tool entries when edit is visible. */
export const EDIT_GUIDANCE = 'Use the edit tool for targeted changes to existing UTF-8 text files. It replaces literal old_string with new_string; by default old_string must appear exactly once. If old_string appears multiple times, provide a more specific old_string or set replace_all to true. Read the file first (the default fs-observation-policy requires it), unless you just created or edited it in this session.'

/**
 * Render the write guidance with the selected edit-tool recommendation.
 * @param hasEdit - whether the same Agent can use the edit contribution.
 * @returns the model-visible write guidance.
 */
export function writeGuidance(hasEdit: boolean): string {
  return 'Use the write tool to create files or completely replace file contents. Existing files are overwritten, so read an existing file first (the default fs-observation-policy requires it)'
    + (hasEdit ? ' and prefer edit for targeted changes' : '')
    + '.'
}

/** Validated read window with configured defaults applied. */
export interface ReadInput {
  filePath: string
  offset: number
  limit: number
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

/**
 * Validate a read request against the deployment's line cap.
 * @param args - schema-validated read arguments.
 * @param maxLimit - default and maximum returned line count.
 * @returns the resolved path and read window.
 */
export function parseReadArgs(args: { file_path: string; offset?: number; limit?: number }, maxLimit: number): ReadInput {
  if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')
  const offset = args.offset === undefined ? 1 : positiveInteger(args.offset, 'offset')
  const limit = args.limit === undefined ? maxLimit : positiveInteger(args.limit, 'limit')
  if (limit > maxLimit) throw new Error(`limit must be less than or equal to ${maxLimit}`)
  return { filePath: args.file_path, offset, limit }
}

/**
 * Validate a full-file write while allowing empty content.
 * @param args - schema-validated write arguments.
 * @returns the path and complete replacement text.
 */
export function parseWriteArgs(args: { file_path: string; content: string }): { filePath: string; content: string } {
  if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')
  return { filePath: args.file_path, content: args.content }
}

/**
 * Format a write outcome without echoing file content to the model.
 * @param displayPath - backend-resolved path.
 * @param outcome - create or update result.
 * @returns the model-facing confirmation envelope.
 */
export function formatWriteOutput(displayPath: string, outcome: Pick<FsWriteOutcome, 'operation'>): string {
  const verb = outcome.operation === 'create' ? 'Created' : 'Updated'
  return `<path>${displayPath}</path>
<type>file</type>
<content>
${verb} file
</content>`
}

/** Validated literal replacement with the default match policy applied. */
export interface EditInput {
  filePath: string
  oldString: string
  newString: string
  replaceAll: boolean
}

/**
 * Validate a literal edit before the provider's atomic match and rewrite.
 * @param args - schema-validated edit arguments.
 * @returns the replacement request with replaceAll defaulted to false.
 */
export function parseEditArgs(args: { file_path: string; old_string: string; new_string: string; replace_all?: boolean }): EditInput {
  if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')
  if (args.old_string.length === 0) throw new Error('old_string must be a non-empty string')
  if (args.old_string === args.new_string) throw new Error('old_string and new_string must differ')
  return {
    filePath: args.file_path,
    oldString: args.old_string,
    newString: args.new_string,
    replaceAll: args.replace_all ?? false,
  }
}

/**
 * Format a successful literal edit without echoing the replacement text.
 * @param displayPath - backend-resolved path.
 * @param replaceAll - whether all matching occurrences were replaced.
 * @returns the model-facing confirmation sentence.
 */
export function formatEditOutput(displayPath: string, replaceAll: boolean): string {
  return replaceAll
    ? `The file ${displayPath} has been updated. All occurrences were successfully replaced.`
    : `The file ${displayPath} has been updated successfully.`
}
