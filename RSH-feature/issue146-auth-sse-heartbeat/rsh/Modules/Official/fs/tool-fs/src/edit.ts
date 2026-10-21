/**
 * Model-facing literal edit, unique-match by default. It obtains an optional guard from the
 * single intent slot, calls `ctx.fs.editText` without a separate stat, then records the observed
 * version; no policy means an unconditional atomic edit.
 * @module @deepseek-ai/dsh-tool-fs/src/edit
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { DiffCallView, DiffResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import { diffsFromMeta } from './diff.ts'
import { diffPresentationMeta } from './presentation-meta.ts'
import { remediateFsError } from './error.ts'
import { sessionResolveOptions } from './session-cwd.ts'
import type { FsSandboxController } from './sandbox.ts'
import { EDIT_GUIDANCE, formatEditOutput, parseEditArgs } from './text-operations.ts'

export { formatEditOutput, parseEditArgs } from './text-operations.ts'

/**
 * The `edit` tool's validated arguments: the base parameters plus the two
 * escalation fields, advertised only under a confining `ctx.fs` (absent from
 * the schema otherwise, so the validator rejects them before `execute`).
 */
interface EditToolArgs {
  file_path: string
  old_string: string
  new_string: string
  replace_all?: boolean
  sandbox_permissions?: string
  justification?: string
}

/**
 * Register the `edit` tool and its scope-aware system-prompt guidance.
 * @param ctx - the plugin context; registrations are effects scoped to it, and execution uses its `fs` service.
 * @param sandbox - the shared sandbox-escalation API (advertisement, mode stamping, denial mapping).
 */
export function applyEditTool(ctx: Context, sandbox: FsSandboxController): void {
  ctx.systemPrompt.section({
    name: 'tool:edit',
    order: ctx.systemPrompt.getSectionOrder('TOOL_EDIT'),
    text: ({ scope }) => ctx.tools.get('edit', scope) === undefined
      ? ''
      : EDIT_GUIDANCE,
  })

  ctx.tools.register(defineTool({
    name: 'edit',
    description: 'Edit an existing UTF-8 text file by replacing literal text.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to edit, resolved by the filesystem backend.' },
      old_string: { type: 'string', required: true, description: 'Literal text to replace. Must match exactly.' },
      new_string: { type: 'string', required: true, description: 'Literal replacement text. Use an empty string to delete the match.' },
      replace_all: { type: 'boolean', description: 'Replace all matches. Defaults to false; when false, old_string must appear exactly once.' },
      ...sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          before: { type: 'string', required: true },
          after: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: formatEditOutput(value.path, args.replace_all ?? false),
      }],
      presentationMeta: (args, value) => diffPresentationMeta(args.file_path, value.before, value.after),
    },
    async execute(args: EditToolArgs, exec) {
      const input = parseEditArgs(args)
      // Resolve the per-call sandbox policy (approved mode > session override
      // > backend default, plus the session cwd root) BEFORE anything executes.
      const sandboxPolicy = await sandbox.resolvePolicy('edit', args, exec)
      const target = await ctx.fs.resolve(input.filePath, sessionResolveOptions(exec, input.filePath, sandboxPolicy?.workspaceRoot))
      // Single-slot decision: the policy plugin returns { version: vObserved } or
      // throws FS_NOT_OBSERVED; the bare default is undefined (unconditional edit).
      // No stat — the bare default never manufactures a version basis. The intent
      // slot itself can throw FS_NOT_OBSERVED for an unread target, so it sits
      // inside the try: both that refusal and the provider's guarded-mutation
      // failure get the model-facing remedy below.
      let outcome
      try {
        const intent = await ctx.waterfall('fs/edit-intent', target, exec, () => undefined)
        outcome = await ctx.fs.editText(
          target,
          { oldString: input.oldString, newString: input.newString, replaceAll: input.replaceAll },
          intent,
          exec.signal,
          sandboxPolicy,
        )
      } catch (error: unknown) {
        // A sandbox denial becomes the shared [sandbox: …] marker (the model
        // recognizes it from bash); guarded mutation failures receive their
        // stable model-facing diagnostic; anything else passes through.
        throw remediateFsError(sandbox.mapError(error, sandboxPolicy), target.displayPath)
      }
      ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
      return {
        path: target.displayPath,
        before: outcome.before,
        after: outcome.after,
      }
    },
    // Pure display: a diff card of the literal replacement (old_string → new_string), derived
    // from the call args. `oldText: old_string || null` matches claude-agent-acp's Edit arm;
    // new_string is a required arg here, so it maps straight to newText.
    presentCall(args): DiffCallView {
      return {
        card: 'diff',
        title: `Edit ${args.file_path}`,
        diffs: [{ path: args.file_path, oldText: args.old_string || null, newText: args.new_string }],
        locations: [{ path: args.file_path }],
      }
    },
    // Applied metadata replaces the call-time snippet; errors or malformed replay metadata use
    // the generic result rendering.
    presentResult(args, result: ToolResult): DiffResultView | undefined {
      if (result.isError) return undefined
      const diffs = diffsFromMeta(result.meta)
      if (diffs === undefined) return undefined
      return { card: 'diff', title: `Edit ${args.file_path}`, diffs }
    },
  }))
}
