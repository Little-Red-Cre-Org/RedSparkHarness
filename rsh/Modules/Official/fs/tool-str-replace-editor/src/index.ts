/**
 * Model-facing `str_replace_editor` over the Harness filesystem seam.
 * @module @redspark/rsh-tool-str-replace-editor
 */

import type { Context } from '@redspark/cordis'
import z from '@redspark/schemastery'
import type {} from '@redspark/rsh-fs'
import type { SandboxExecutionPolicy } from '@redspark/rsh-sandbox'
import type { SandboxPolicyService } from '@redspark/rsh-sandbox-policy'
import { defineTool } from '@redspark/rsh-tools'
import type { ToolCallView, ToolRunContext } from '@redspark/rsh-tools'
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_MAX_OUTPUT_CHARS,
  EDITOR_PARAMETER_TEXT,
  resolveEditorConfig,
  runEditorCommand,
  type EditorRuntime,
} from './editor-core.ts'

class MutationPolicy {
  private readonly policy: SandboxPolicyService | undefined

  constructor(ctx: Context) {
    this.policy = ctx.fs.sandboxMode === undefined ? undefined : ctx.get('sandboxPolicy')
    if (ctx.fs.sandboxMode !== undefined && this.policy === undefined) {
      throw new Error('tool-str-replace-editor: the mounted filesystem confines but ctx.sandboxPolicy is missing')
    }
  }

  resolve(exec: ToolRunContext): SandboxExecutionPolicy | undefined {
    return this.policy?.resolve({
      ...exec.agent === undefined ? {} : { session: exec.agent.session },
    })
  }
}

function editorRuntime(ctx: Context, policy: MutationPolicy, exec: ToolRunContext): EditorRuntime {
  return {
    fs: ctx.fs,
    signal: exec.signal,
    sandboxPolicy: () => policy.resolve(exec),
    writeIntent: target => ctx.waterfall(
      'fs/write-intent',
      target,
      exec,
      () => ({ kind: 'createIfAbsent' as const }),
    ),
    editIntent: target => ctx.waterfall('fs/edit-intent', target, exec, () => undefined),
    observed: (target, observation) => {
      ctx.emit('fs/observed', target, observation, exec)
    },
  }
}

function presentEditorCall(args: {
  command: 'view' | 'create' | 'str_replace' | 'insert'
  path: string
  file_text?: string | null
  insert_line?: number | null
  new_str?: string | null
  old_str?: string | null
}): ToolCallView {
  switch (args.command) {
    case 'view':
      return {
        card: 'generic',
        title: `view ${args.path}`,
        kind: 'read',
        locations: [{ path: args.path }],
      }
    case 'create':
      return {
        card: 'diff',
        title: `create ${args.path}`,
        diffs: [{ path: args.path, oldText: null, newText: args.file_text ?? '' }],
        locations: [{ path: args.path }],
      }
    case 'str_replace':
      return {
        card: 'diff',
        title: `str_replace ${args.path}`,
        diffs: [{
          path: args.path,
          oldText: args.old_str ?? null,
          newText: args.new_str ?? '',
        }],
        locations: [{ path: args.path }],
      }
    case 'insert':
      return {
        card: 'generic',
        title: `insert ${args.path}`,
        kind: 'edit',
        locations: [{
          path: args.path,
          ...args.insert_line === undefined || args.insert_line === null
            ? {}
            : { line: Math.max(1, args.insert_line + 1) },
        }],
      }
  }
}

/** Register the model-facing `str_replace_editor` tool. */
function registerStrReplaceEditor(ctx: Context, config: { maxOutputChars: number; description: string }): void {
  const policy = new MutationPolicy(ctx)
  ctx.tools.register(defineTool({
    name: 'str_replace_editor',
    description: config.description,
    parameters: {
      command: {
        type: 'string',
        required: true,
        enum: ['view', 'create', 'str_replace', 'insert'],
        description: EDITOR_PARAMETER_TEXT.command,
      },
      path: {
        type: 'string',
        required: true,
        description: EDITOR_PARAMETER_TEXT.path,
      },
      file_text: {
        oneOf: [{ type: 'string' }, { type: 'null' }],
        description: EDITOR_PARAMETER_TEXT.fileText,
      },
      insert_line: {
        oneOf: [{ type: 'integer' }, { type: 'null' }],
        description: EDITOR_PARAMETER_TEXT.insertLine,
      },
      new_str: {
        oneOf: [{ type: 'string' }, { type: 'null' }],
        description: EDITOR_PARAMETER_TEXT.newStr,
      },
      old_str: {
        oneOf: [{ type: 'string' }, { type: 'null' }],
        description: EDITOR_PARAMETER_TEXT.oldStr,
      },
      view_range: {
        oneOf: [
          { type: 'array', items: { type: 'integer' } },
          { type: 'null' },
        ],
        description: EDITOR_PARAMETER_TEXT.viewRange,
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      return runEditorCommand(editorRuntime(ctx, policy, exec), {
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
    presentCall: presentEditorCall,
  }))
}

export const name = 'tool-str-replace-editor'
export const inject = ['tools', 'fs']

/** Configuration for the string-replacement editor tool. */
export interface Config {
  /** Maximum returned view characters before clipping (default 16000). */
  maxOutputChars?: number
  /** Model-facing tool description. */
  description?: string
}

/** Runtime configuration schema for the string-replacement editor tool. */
export const Config: z<Config> = z.object({
  maxOutputChars: z.number().default(DEFAULT_MAX_OUTPUT_CHARS),
  description: z.string().default(DEFAULT_DESCRIPTION),
})

/** Register one `str_replace_editor` tool over `ctx.fs`. */
export function apply(ctx: Context, config: Config): void {
  registerStrReplaceEditor(ctx, resolveEditorConfig(config))
}
