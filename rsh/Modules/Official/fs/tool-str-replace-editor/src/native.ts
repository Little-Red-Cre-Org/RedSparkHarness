/** Native `str_replace_editor` over the selected filesystem and tool registry. */
import type { NativeContext, NativePlugin } from '@redspark/rsh-native-runtime'
import type { FileSystemOperations, FsTarget } from '@redspark/rsh-fs/native'
import type {} from '@redspark/rsh-fs/native'
import type {} from '@redspark/rsh-native-tools/native'
import type {} from '@redspark/rsh-native-sandbox-policy/native'
import type { NativeToolExecution, NativeValueToolContribution } from '@redspark/rsh-native-tools'
import {
  EDITOR_PARAMETER_TEXT,
  resolveEditorConfig,
  runEditorCommand,
  type EditorConfig,
  type EditorRuntime,
} from './editor-core.ts'

const COMMANDS = ['view', 'create', 'str_replace', 'insert'] as const

interface EditorArguments {
  command: (typeof COMMANDS)[number]
  path: string
  file_text?: string | null
  insert_line?: number | null
  new_str?: string | null
  old_str?: string | null
  view_range?: number[] | null
}

function nullable(type: 'string' | 'integer' | 'array'): { oneOf: [{ type: typeof type; items?: { type: 'integer' } }, { type: 'null' }] } {
  return type === 'array'
    ? { oneOf: [{ type: 'array', items: { type: 'integer' } }, { type: 'null' }] }
    : { oneOf: [{ type }, { type: 'null' }] }
}

function actor(call: NativeToolExecution): { agent: { session: object } } {
  return { agent: { session: call.session } }
}

function runtime(context: NativeContext, fs: FileSystemOperations, call: NativeToolExecution): EditorRuntime {
  const identity = actor(call)
  return {
    fs,
    signal: call.signal,
    sandboxPolicy: () => context.optional('sandboxPolicy')?.resolve({ session: call.session }),
    writeIntent: (target: FsTarget) => context.events.waterfall(
      context.scope,
      'fs/write-intent',
      () => ({ kind: 'createIfAbsent' as const }),
      target,
      identity,
    ),
    editIntent: (target: FsTarget) => context.events.waterfall(
      context.scope,
      'fs/edit-intent',
      () => undefined,
      target,
      identity,
    ),
    observed: (target, observation) => {
      context.events.emit(context.scope, 'fs/observed', target, observation, identity)
    },
  }
}

function editorTool(context: NativeContext, fs: FileSystemOperations, config: EditorConfig): NativeValueToolContribution {
  return {
    schema: {
      name: 'str_replace_editor',
      description: config.description,
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            enum: [...COMMANDS],
            description: EDITOR_PARAMETER_TEXT.command,
          },
          path: { type: 'string', description: EDITOR_PARAMETER_TEXT.path },
          file_text: { ...nullable('string'), description: EDITOR_PARAMETER_TEXT.fileText },
          insert_line: { ...nullable('integer'), description: EDITOR_PARAMETER_TEXT.insertLine },
          new_str: { ...nullable('string'), description: EDITOR_PARAMETER_TEXT.newStr },
          old_str: { ...nullable('string'), description: EDITOR_PARAMETER_TEXT.oldStr },
          view_range: { ...nullable('array'), description: EDITOR_PARAMETER_TEXT.viewRange },
        },
        required: ['command', 'path'],
      },
    },
    output: {
      schema: { type: 'string' },
      render(_call, value) {
        const text = value as string
        return { isError: false, content: [{ type: 'text', text }] }
      },
    },
    async execute(call) {
      const args = call.arguments as EditorArguments
      return runEditorCommand(runtime(context, fs, call), {
        command: args.command,
        path: args.path,
        fileText: args.file_text,
        oldStr: args.old_str,
        newStr: args.new_str,
        insertLine: args.insert_line,
        viewRange: args.view_range,
        maxOutputChars: config.maxOutputChars,
      })
    },
  }
}

/** Register one native `str_replace_editor`; disposal removes that registration. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-tool-str-replace-editor',
  targets: ['host'],
  requires: ['fs', 'fsObservationPolicy', 'tools'],
  optional: ['sandboxPolicy'],
  provides: [],
  resolve(input) {
    const config = resolveEditorConfig(input)
    return (context) => {
      const fs = context.require('fs')
      context.require('fsObservationPolicy')
      const tools = context.require('tools')
      if (fs.sandboxMode !== undefined && context.optional('sandboxPolicy') === undefined) {
        throw new Error('tool-str-replace-editor: the mounted filesystem confines but ctx.sandboxPolicy is missing')
      }
      context.effect(tools.registerValueTool(editorTool(context, fs, config), context.scope))
    }
  },
}
