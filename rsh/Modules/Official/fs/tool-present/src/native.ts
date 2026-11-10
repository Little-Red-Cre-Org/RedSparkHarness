/** Native present contribution: declares finished files as deliverables of the open turn. */
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { FileSystemOperations } from '@redspark/rsh-fs/native'
import type { NativeToolExecution, NativeValueToolContribution } from '@redspark/rsh-native-tools'
import type { PresentedFile } from './types.ts'

/** Per-call delivery limit used when the composition states none. */
const DEFAULT_MAX_FILES = 8

/** Validated delivery limit from the profile row. */
interface Config {
  readonly maxFiles: number
}

/** Result a successful delivery returns to the model. */
interface PresentedOutcome {
  readonly turn: number
  readonly files: readonly PresentedFile[]
}

/**
 * Read the configured per-call delivery limit.
 * @param input - raw row configuration.
 * @returns the validated limit.
 */
function resolveConfig(input: unknown): Config {
  const raw = (input ?? {}) as { maxFiles?: unknown }
  const maxFiles = raw.maxFiles ?? DEFAULT_MAX_FILES
  if (typeof maxFiles !== 'number' || !Number.isSafeInteger(maxFiles) || maxFiles < 1) {
    throw new Error('present requires a positive integer maxFiles')
  }
  return { maxFiles }
}

/**
 * Build the present contribution over the mounted filesystem.
 * @param fs - formatted filesystem operations the Session addresses paths through.
 * @param maxFiles - maximum files one call may declare.
 * @returns the value tool and its presentation.
 */
function presentTool(fs: FileSystemOperations, maxFiles: number): NativeValueToolContribution {
  return {
    schema: {
      name: 'present',
      description: 'Declare existing files accessible through the Session filesystem as final deliverables. '
        + 'When a file you create or update is an output the user asked to receive, you must call present after writing it and before your final response, including files created through Bash or code execution. '
        + 'Mentioning its path in your reply does not replace this call. The files must already exist. '
        + 'The user opens the current source files; their contents are not copied or preserved.',
      parameters: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Path of an existing regular file. Relative paths use the Session working directory.' },
                description: { type: 'string', description: 'Brief description for the user.' },
              },
              required: ['path'],
              additionalProperties: false,
            },
          },
        },
        required: ['files'],
        additionalProperties: false,
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          turn: { type: 'integer' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                description: { type: 'string' },
              },
              required: ['path'],
              additionalProperties: false,
            },
          },
        },
        required: ['turn', 'files'],
        additionalProperties: false,
      },
      render(_call, canonical) {
        const value = canonical as unknown as PresentedOutcome
        return {
          isError: false,
          content: [{ type: 'text', text: value.files.map(file => `Presented ${file.path}`).join('\n') }],
        }
      },
    },
    async execute(call: NativeToolExecution): Promise<PresentedOutcome> {
      const args = call.arguments as { files?: readonly { path?: string; description?: string }[] }
      const requested = args.files ?? []
      if (call.turn === undefined) throw new Error('present requires an open turn')
      if (requested.length === 0 || requested.length > maxFiles) throw new Error(`present accepts 1 to ${maxFiles} files`)
      const cwd = call.session.header.cwd
      if (cwd === undefined) throw new Error('present requires a workspace')
      const files: PresentedFile[] = []
      for (const file of requested) {
        const path = file.path
        if (path === undefined || path.trim().length === 0) throw new Error('present requires a non-empty file path')
        const entry = await fs.lstat(path, { cwd }, call.signal)
        if (entry !== undefined && entry.type !== 'file') throw new Error(`Cannot present ${path}: not a regular file`)
        const target = await fs.resolve(path, { cwd, signal: call.signal })
        const info = await fs.stat(target, call.signal)
        if (info === undefined) throw new Error(`Cannot present ${path}: file not found. Check the path, create the file if needed, and retry.`)
        if (info.type !== 'file') throw new Error(`Cannot present ${path}: not a regular file`)
        files.push(file.description === undefined ? { path } : { path, description: file.description })
      }
      call.signal.throwIfAborted()
      // The durable record of a delivery is the event, not the tool result.
      await call.appendEvent('deliverables/presented', { turn: call.turn, callId: call.callId, files })
      return { turn: call.turn, files }
    },
  }
}

/** Native contribution installing the present tool. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@redspark/rsh-tool-present', targets: ['host'],
  requires: ['fs', 'tools'], optional: [], provides: [],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      const fs = context.require('fs')
      const tools = context.require('tools')
      context.effect(tools.registerValueTool(presentTool(fs, config.maxFiles), context.scope))
    }
  },
}
