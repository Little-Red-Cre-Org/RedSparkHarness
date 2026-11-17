/**
 * View, create, unique literal replace, and line insert over a filesystem.
 * Cordis and native registrations share this module; it imports no Cordis root.
 * @module @redspark/rsh-tool-str-replace-editor/editor-core
 */

import { isAbsolute } from 'node:path'
import {
  FsError,
  type FileSystemOperations,
  type FsInfo,
  type FsObservation,
  type FsTarget,
  type FsVersion,
  type FsWriteIntent,
} from '@redspark/rsh-fs/native'
import { sandboxDenialMarker, type SandboxExecutionPolicy } from '@redspark/rsh-sandbox/native'

const TRUNCATED_MESSAGE = '<response clipped><NOTE>To save on context only part of this file has been shown to you. You should retry this tool after you have searched inside the file with `grep -n` in order to find the line numbers of what you are looking for.</NOTE>'

/** Default view prefix retained before the clipping notice. */
export const DEFAULT_MAX_OUTPUT_CHARS = 16_000

/** Default model-facing tool description. */
export const DEFAULT_DESCRIPTION = `
Custom editing tool for viewing, creating and editing files
* State is persistent across command calls and discussions with the user
* If \`path\` is a file, \`view\` displays the result of applying \`cat -n\`. If \`path\` is a directory, \`view\` lists non-hidden files and directories up to 2 levels deep
* The \`create\` command cannot be used if the specified \`path\` already exists as a file
* If a \`command\` generates a long output, it will be truncated and marked with \`<response clipped>\`
* A null placeholder for a parameter unused by the selected command is treated as omitted. Required parameters still need values; omit \`str_replace.new_str\` rather than setting it to null when deleting a match

Notes for using the \`str_replace\` command:
* The \`old_str\` parameter should match EXACTLY one or more consecutive lines from the original file. Be mindful of whitespaces!
* If the \`old_str\` parameter is not unique in the file, the replacement will not be performed. Make sure to include enough context in \`old_str\` to make it unique
* The \`new_str\` parameter should contain the edited lines that should replace the \`old_str\`
`.trim()

/** Model-facing parameter descriptions shared by both registrations. */
export const EDITOR_PARAMETER_TEXT = {
  command: 'The commands to run. Allowed options are: `view`, `create`, `str_replace`, `insert`.',
  path: 'Absolute path to file or directory, e.g. `/repo/file.py` or `/repo`.',
  fileText: 'Required string parameter of `create` command, with the content of the file to be created. A null placeholder is treated as omitted by commands that do not use this parameter.',
  insertLine: 'Required integer parameter of `insert` command. The `new_str` will be inserted AFTER the line `insert_line` of `path`. A null placeholder is treated as omitted by commands that do not use this parameter.',
  newStr: 'Optional string parameter of `str_replace` command containing the new string (if omitted, no string will be added). Required string parameter of `insert` command containing the string to insert. A null placeholder is accepted only by commands that do not use this parameter.',
  oldStr: 'Required string parameter of `str_replace` command containing the string in `path` to replace. A null placeholder is treated as omitted by commands that do not use this parameter.',
  viewRange: 'Optional parameter of `view` command when `path` points to a file. If omitted or null, the full file is shown. If provided, the file will be shown in the indicated line number range, e.g. [11, 12] will show lines 11 and 12. Indexing at 1 to start. Setting `[start_line, -1]` shows all lines from `start_line` to the end of the file.',
} as const

/** Limits one registration applies to every command. */
export interface EditorConfig {
  readonly maxOutputChars: number
  readonly description: string
}

/**
 * Filesystem and policy callbacks for one admitted call.
 * `writeIntent` uses `createIfAbsent` when no listener returns a guard.
 * `editIntent` returns undefined when no listener supplies a version.
 */
export interface EditorRuntime {
  readonly fs: FileSystemOperations
  readonly signal: AbortSignal
  sandboxPolicy(): SandboxExecutionPolicy | undefined
  writeIntent(target: FsTarget): Promise<FsWriteIntent | undefined>
  editIntent(target: FsTarget): Promise<{ readonly version: FsVersion } | undefined>
  observed(target: FsTarget, observation: FsObservation): void
}

/** One `str_replace_editor` command, including null placeholders. */
export interface EditorRequest {
  readonly command: 'view' | 'create' | 'str_replace' | 'insert'
  readonly path: string
  readonly fileText: string | null | undefined
  readonly oldStr: string | null | undefined
  readonly newStr: string | null | undefined
  readonly insertLine: number | null | undefined
  readonly viewRange: readonly number[] | null | undefined
  readonly maxOutputChars: number
}

/**
 * Apply the editor's configuration limits.
 * Omitted fields use the same defaults as the Cordis schema.
 * @param input - raw configuration object, or omitted for the defaults.
 * @returns the limits the tool registration uses.
 */
export function resolveEditorConfig(input: unknown): EditorConfig {
  const fields = input === undefined ? {} : input
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    throw new Error('tool-str-replace-editor: configuration must be an object')
  }
  const record = fields as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (key !== 'maxOutputChars' && key !== 'description') {
      throw new Error(`tool-str-replace-editor: unknown configuration field ${key}`)
    }
  }
  const maxOutputChars = record.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS
  const description = record.description ?? DEFAULT_DESCRIPTION
  if (typeof maxOutputChars !== 'number' || !Number.isSafeInteger(maxOutputChars) || maxOutputChars <= 0) {
    throw new Error('tool-str-replace-editor: maxOutputChars must be a positive safe integer')
  }
  if (typeof description !== 'string' || description.trim().length === 0) {
    throw new Error('tool-str-replace-editor: description must be non-empty')
  }
  return { maxOutputChars, description }
}

/**
 * Run one view, create, replace, or insert command.
 * @param runtime - filesystem and policy callbacks for this call.
 * @param request - admitted command fields, including null placeholders.
 * @returns model-facing result text.
 */
export async function runEditorCommand(runtime: EditorRuntime, request: EditorRequest): Promise<string> {
  switch (request.command) {
    case 'view':
      return viewPath(runtime, request.path, request.viewRange ?? undefined, request.maxOutputChars)
    case 'create':
      return createFile(runtime, request.path, request.fileText ?? undefined)
    case 'str_replace':
      return replaceInFile(runtime, request.path, request.oldStr ?? undefined, request.newStr)
    case 'insert':
      return insertInFile(runtime, request.path, request.insertLine ?? undefined, request.newStr ?? undefined)
  }
}

function mapEditorMutationError(error: unknown, policy: SandboxExecutionPolicy | undefined): unknown {
  if (!(error instanceof FsError) || error.code !== 'FS_SANDBOX_DENIED') return error
  const mode = (policy as SandboxExecutionPolicy).mode
  return new FsError(sandboxDenialMarker(mode), 'FS_SANDBOX_DENIED', { cause: error })
}

function maybeTruncate(content: string, maxOutputChars: number): string {
  return content.length <= maxOutputChars
    ? content
    : content.slice(0, maxOutputChars) + TRUNCATED_MESSAGE
}

function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function matchOffsets(content: string, search: string): number[] {
  const offsets: number[] = []
  let offset = 0
  while (true) {
    const match = content.indexOf(search, offset)
    if (match < 0) return offsets
    offsets.push(match)
    offset = match + search.length
  }
}

function lineNumbersAt(content: string, offsets: readonly number[]): number[] {
  let line = 1
  let cursor = 0
  return offsets.map((offset) => {
    while (cursor < offset) {
      if (content[cursor] === '\n') line += 1
      cursor += 1
    }
    return line
  })
}

async function resolveTarget(runtime: EditorRuntime, path: string): Promise<FsTarget> {
  if (path.trim().length === 0) throw new Error('path must be a non-empty string')
  if (!isAbsolute(path)) {
    throw new Error(`The path ${path} is not an absolute path, it should start with \`/\`. Maybe you meant /${path}?`)
  }
  return runtime.fs.resolve(path, { signal: runtime.signal })
}

async function statExisting(
  runtime: EditorRuntime,
  target: FsTarget,
  command: 'view' | 'str_replace' | 'insert',
): Promise<FsInfo> {
  const info = await runtime.fs.stat(target, runtime.signal)
  if (info === undefined) {
    runtime.observed(target, { kind: 'absent' })
    throw new FsError(
      `The path ${target.displayPath} does not exist. Please provide a valid path.`,
      'FS_NOT_FOUND',
    )
  }
  if (info.type === 'directory' && command !== 'view') {
    throw new FsError(
      `The path ${target.displayPath} is a directory and only the \`view\` command can be used on directories`,
      'FS_NOT_REGULAR_FILE',
    )
  }
  return info
}

function requiredForCommand(
  value: string | undefined,
  parameter: string,
  command: string,
  allowEmpty = true,
): string {
  if (value === undefined) throw new Error(`Parameter \`${parameter}\` is required for command: ${command}`)
  if (!allowEmpty && value.length === 0) {
    throw new Error(`Parameter \`${parameter}\` is empty for command: ${command}`)
  }
  return value
}

function formatFileView(
  path: string,
  content: string,
  maxOutputChars: number,
  viewRange?: readonly number[],
): string {
  const allLines = content.split('\n')
  let lines = allLines
  let initialLine = 1
  let finalLine: number | undefined
  let prompt = `Here's the content of ${path} with line numbers (which has a total of ${allLines.length} lines)`
  if (viewRange !== undefined) {
    const [requestedInitialLine, requestedFinalLine] = viewRange
    if (
      viewRange.length !== 2
      || requestedInitialLine === undefined
      || requestedFinalLine === undefined
      || !viewRange.every(Number.isInteger)
    ) {
      throw new Error('Invalid `view_range`. It should be a list of two integers.')
    }
    initialLine = requestedInitialLine
    finalLine = requestedFinalLine
    if (initialLine < 1 || initialLine > allLines.length) {
      throw new Error(
        `Invalid \`view_range\`: [${viewRange.join(', ')}]. Its first element \`${initialLine}\` should be within the range of lines of the file: [1, ${allLines.length}]`,
      )
    }
    if (finalLine > allLines.length) {
      throw new Error(
        `Invalid \`view_range\`: [${viewRange.join(', ')}]. Its second element \`${finalLine}\` should be smaller than the number of lines in the file: \`${allLines.length}\``,
      )
    }
    if (finalLine !== -1 && finalLine < initialLine) {
      throw new Error(
        `Invalid \`view_range\`: [${viewRange.join(', ')}]. Its second element \`${finalLine}\` should be larger or equal than its first \`${initialLine}\``,
      )
    }
    lines = finalLine === -1
      ? allLines.slice(initialLine - 1)
      : allLines.slice(initialLine - 1, finalLine)
    prompt += ` with view_range=[${initialLine}, ${finalLine}]`
  }
  const numbered = lines
    .map((line, index) => `${String(initialLine + index).padStart(6, ' ')}  ${line}`)
    .join('\n')
  return maybeTruncate(`${prompt}:\n${numbered}\n`, maxOutputChars)
}

async function listDirectory(runtime: EditorRuntime, target: FsTarget, maxOutputChars: number): Promise<string> {
  async function visit(dir: FsTarget, depth: number): Promise<string[]> {
    const entries = await runtime.fs.listDir(dir, runtime.signal)
    const rows: string[] = []
    for (const entry of entries.filter(candidate =>
      !candidate.name.startsWith('.')
      && candidate.name !== 'node_modules'
      && candidate.name !== '__pycache__')) {
      const type = entry.type === 'directory' ? 'd' : entry.type === 'file' ? 'f' : '?'
      rows.push(`${type}\t${entry.target.displayPath}`)
      if (entry.type === 'directory' && depth < 2) {
        rows.push(...await visit(entry.target, depth + 1))
      }
    }
    return rows
  }
  const rows = [`d\t${target.displayPath}`, ...await visit(target, 1)]
  rows.sort((left, right) => {
    const leftPath = left.slice(left.indexOf('\t') + 1)
    const rightPath = right.slice(right.indexOf('\t') + 1)
    return codepointCompare(leftPath, rightPath)
  })
  const listing = maybeTruncate(rows.join('\n') + '\n', maxOutputChars)
  return `Here're the files and directories up to 2 levels deep in ${target.displayPath}, excluding hidden items, node_modules, and Python cache directories:\n${listing}\n`
}

async function viewPath(
  runtime: EditorRuntime,
  path: string,
  viewRange: readonly number[] | undefined,
  maxOutputChars: number,
): Promise<string> {
  const target = await resolveTarget(runtime, path)
  const info = await statExisting(runtime, target, 'view')
  if (info.type === 'directory') {
    if (viewRange !== undefined) {
      throw new Error('The `view_range` parameter is not allowed when `path` points to a directory.')
    }
    return listDirectory(runtime, target, maxOutputChars)
  }
  if (info.type !== 'file') {
    throw new FsError(`cannot view "${target.displayPath}": not a regular file or directory`, 'FS_NOT_REGULAR_FILE')
  }
  const content = await runtime.fs.readText(target, runtime.signal)
  runtime.observed(target, { kind: 'present', version: info.version })
  return formatFileView(target.displayPath, content, maxOutputChars, viewRange)
}

async function createFile(runtime: EditorRuntime, path: string, fileText: string | undefined): Promise<string> {
  const content = requiredForCommand(fileText, 'file_text', 'create')
  const sandboxPolicy = runtime.sandboxPolicy()
  const target = await resolveTarget(runtime, path)
  if (await runtime.fs.stat(target, runtime.signal) !== undefined) {
    throw new Error(`File already exists at: ${target.displayPath}. Cannot overwrite files using command \`create\`.`)
  }
  const intent = await runtime.writeIntent(target)
  let outcome
  try {
    outcome = await runtime.fs.writeText(target, content, intent, runtime.signal, sandboxPolicy)
  } catch (error: unknown) {
    throw mapEditorMutationError(error, sandboxPolicy)
  }
  runtime.observed(target, { kind: 'present', version: outcome.version })
  return `New file created successfully at: ${target.displayPath}`
}

async function replaceInFile(
  runtime: EditorRuntime,
  path: string,
  oldStr: string | undefined,
  newStr: string | null | undefined,
): Promise<string> {
  if (newStr === null) {
    throw new Error('Parameter `new_str` must be omitted or contain a string for command: str_replace')
  }
  const sandboxPolicy = runtime.sandboxPolicy()
  const target = await resolveTarget(runtime, path)
  const intent = await runtime.editIntent(target)
  const oldValue = requiredForCommand(oldStr, 'old_str', 'str_replace', false)
  const newValue = newStr ?? ''
  const info = await statExisting(runtime, target, 'str_replace')
  if (info.type !== 'file') {
    throw new FsError(`cannot edit "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  }
  const before = await runtime.fs.readText(target, runtime.signal)
  const offsets = matchOffsets(before, oldValue)
  const offset = offsets[0]
  if (offset === undefined) {
    throw new FsError(
      `No replacement was performed, old_str \`${oldValue}\` did not appear verbatim in ${target.displayPath}.`,
      'FS_EDIT_NOT_FOUND',
    )
  }
  if (offsets.length > 1) {
    const lines = lineNumbersAt(before, offsets)
    throw new FsError(
      `No replacement was performed. Multiple occurrences of old_str \`${oldValue}\` in lines [${lines.join(', ')}]. Please ensure it is unique`,
      'FS_AMBIGUOUS_EDIT',
    )
  }
  let outcome
  try {
    outcome = await runtime.fs.writeText(
      target,
      before.slice(0, offset) + newValue + before.slice(offset + oldValue.length),
      intent === undefined
        ? { kind: 'replaceIfVersion', version: info.version }
        : { kind: 'replaceIfVersion', version: intent.version },
      runtime.signal,
      sandboxPolicy,
    )
  } catch (error: unknown) {
    throw mapEditorMutationError(error, sandboxPolicy)
  }
  runtime.observed(target, { kind: 'present', version: outcome.version })
  return `The file ${target.displayPath} has been edited successfully.`
}

async function insertInFile(
  runtime: EditorRuntime,
  path: string,
  insertLine: number | undefined,
  newStr: string | undefined,
): Promise<string> {
  if (insertLine === undefined) throw new Error('Parameter `insert_line` is required for command: insert')
  const value = requiredForCommand(newStr, 'new_str', 'insert')
  const sandboxPolicy = runtime.sandboxPolicy()
  const target = await resolveTarget(runtime, path)
  const intent = await runtime.editIntent(target)
  const info = await statExisting(runtime, target, 'insert')
  if (info.type !== 'file') {
    throw new FsError(`cannot insert into "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  }
  const before = await runtime.fs.readText(target, runtime.signal)
  const lines = before.split('\n')
  if (!Number.isInteger(insertLine) || insertLine < 0 || insertLine > lines.length) {
    throw new Error(
      `Invalid \`insert_line\` parameter: ${insertLine}. It should be within the range of lines of the file: [0, ${lines.length}]`,
    )
  }
  const after = [
    ...lines.slice(0, insertLine),
    ...value.split('\n'),
    ...lines.slice(insertLine),
  ].join('\n')
  const expected: FsWriteIntent = intent === undefined
    ? { kind: 'replaceIfVersion', version: info.version }
    : { kind: 'replaceIfVersion', version: intent.version }
  let outcome
  try {
    outcome = await runtime.fs.writeText(target, after, expected, runtime.signal, sandboxPolicy)
  } catch (error: unknown) {
    throw mapEditorMutationError(error, sandboxPolicy)
  }
  runtime.observed(target, { kind: 'present', version: outcome.version })
  return `The file ${target.displayPath} has been edited successfully.`
}
