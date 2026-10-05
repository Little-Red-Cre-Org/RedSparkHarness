/**
 * The model-facing `glob` tool: discover files whose paths match a glob
 * pattern, sorted by modification time. Execution spawns the packaged
 * ripgrep binary (`@vscode/ripgrep`) directly through the subprocess seam
 * with a plain argv vector — this module owns the model-facing schema,
 * argument validation, argv construction, result parsing, inline sampling,
 * and formatting; process concerns (spawn execution, tree termination,
 * environment scrubbing, output capture) stay behind `ctx.subprocess`.
 * @module @deepseek-ai/dsh-tool-fs-search/glob
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, SearchResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import { runRipgrep, toWorkdirRelative, trySaveFormattedResult } from './search-core.ts'
import { globSearchMeta, searchViewFromMeta } from './presentation.ts'
import { acceptedDirectCallValue } from './direct-call.ts'

import { globGuidance, globDescription, GLOB_PATTERN_DESCRIPTION, parseGlobArgs, buildGlobCommand, renderGlobPaths, globCardPage } from './glob-core.ts'
import type { GlobToolCaps } from './glob-core.ts'
export { GLOB_MAX_RESULTS, GLOB_VCS_EXCLUDES, parseGlobArgs, buildGlobCommand, sampleAcrossTopLevel, formatGlobOutput } from './glob-core.ts'
export type { GlobToolCaps, GlobInput, GlobSample } from './glob-core.ts'

/**
 * Pending-call presentation: a search card titled by the pattern (and root).
 *
 * @param args - the raw tool arguments; `pattern` and `path` feed the title.
 * @returns the generic card view (`kind: 'search'`) shown while the call runs.
 */
export function presentGlobCall(args: { pattern: string; path?: string }): GenericCallView {
  const where = args.path !== undefined ? ` in ${args.path}` : ''
  return { card: 'generic', title: `Glob ${args.pattern}${where}`, kind: 'search', rawInput: args.pattern }
}

/**
 * Completed-call presentation: the search card projected from the result's
 * `presentationMeta` (the discovered path list, with the truncation signal). A UI
 * without a search card falls back to the raw `tool/result` content, so the view
 * carries no result text of its own. Malformed or absent metadata (an obsolete or
 * hand-edited replayed log) falls back to the generic card.
 *
 * @param _args - the raw tool arguments; unused, the view derives from the result.
 * @param result - the final model-facing tool result carrying the projected metadata.
 * @returns the search card view, or `undefined` for the generic fallback.
 */
export function presentGlobResult(_args: { pattern: string; path?: string }, result: ToolResult): SearchResultView | undefined {
  if (result.isError) return undefined
  const view = searchViewFromMeta(result.meta)
  if (view === undefined || view.shape !== 'paths') return undefined
  return view
}

/**
 * Register the `glob` tool and its scope-aware system-prompt guidance.
 *
 * @param ctx - the plugin context; registrations are effects scoped to it, and
 *   execution uses its `subprocess` service.
 * @param caps - the deployment's resolved glob caps (plugin config after defaulting).
 */
export function applyGlobTool(ctx: Context, caps: GlobToolCaps): void {
  ctx.systemPrompt.section({
    name: 'tool:glob',
    order: ctx.systemPrompt.getSectionOrder('TOOL_GLOB'),
    text: ({ scope }) => ctx.tools.get('glob', scope) === undefined
      ? ''
      : globGuidance(caps),
  })

  const tool = defineTool({
    name: 'glob',
    description: globDescription(caps),
    parameters: {
      pattern: {
        type: 'string',
        required: true,
        description: GLOB_PATTERN_DESCRIPTION,
      },
      path: { type: 'string', description: 'Directory to search in. Defaults to the session workspace; a relative path resolves against it.' },
    },
    timeoutMs: caps.timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', required: true },
          paths: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderGlobPaths(value.paths, caps, value.root) }],
      presentationMeta: (_args, value) => {
        const page = globCardPage(value.paths, caps, value.root)
        return globSearchMeta({ items: page.items, truncated: page.truncated, seen: value.paths.length }, caps.maxMetaBytes)
      },
    },
    async execute(args, exec) {
      const input = parseGlobArgs(args)
      const run = await runRipgrep(ctx, exec, 'glob', buildGlobCommand(input), caps.rawOutputMaxBytes, caps.graceMs, caps.stderrMaxBytes)
      const root = input.path === undefined ? '.' : toWorkdirRelative(input.path, run.workdir)
      if (run.noMatches) return { root, paths: [] }

      const all: string[] = []
      for (const line of run.stdout.split('\n')) {
        if (line.length === 0) continue
        const displayPath = toWorkdirRelative(line, run.workdir)
        all.push(displayPath)
      }
      return { root, paths: all }
    },
    presentCall: presentGlobCall,
    presentResult: presentGlobResult,
  })
  ctx.tools.register(tool)

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    const value = acceptedDirectCallValue(ctx, tool, exec, result, decision) as { root: string; paths: string[] } | undefined
    if (value === undefined) return decision
    const paths = value.paths
    if (paths.length <= caps.maxResults) return decision
    const spillRef = await trySaveFormattedResult(ctx, exec, 'glob-results.txt', paths.join('\n'))
    return {
      kind: 'accept',
      content: [{ type: 'text', text: renderGlobPaths(paths, caps, value.root, spillRef) }],
      ...decision.additionalContexts !== undefined ? { additionalContexts: decision.additionalContexts } : {},
    }
  })
}
