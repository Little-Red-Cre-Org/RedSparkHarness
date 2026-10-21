/**
 * The model-facing `grep` tool: search file contents with a ripgrep regular
 * expression. Execution spawns the packaged ripgrep binary
 * (`@vscode/ripgrep`) directly through the subprocess seam with a plain argv
 * vector using a fixed line-oriented `rg --json` command so file path, line
 * number, and line text parse without colon-splitting ambiguity — this module
 * owns the model-facing schema, argument validation, argv construction,
 * `--json` record parsing, per-line preview retention, match retention,
 * grouping, and formatting; process concerns stay behind `ctx.subprocess`.
 *
 * @module @deepseek-ai/dsh-tool-fs-search/grep
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, SearchResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { GrepMatch } from './search-core.ts'
import { previewLine, retainGrepMatches, runRipgrep, toWorkdirRelative, trySaveFormattedResult } from './search-core.ts'
import { grepSearchMeta, searchViewFromMeta } from './presentation.ts'
import { acceptedDirectCallValue } from './direct-call.ts'

import { parseGrepArgs, buildGrepCommand, parseGrepMatches, matchNoun, formatGrepMatches, formatRetainedGrep } from './grep-core.ts'
import type { GrepToolCaps } from './grep-core.ts'
export { GREP_MAX_MATCHES, GREP_MAX_LINE_BYTES, parseGrepArgs, buildGrepCommand, parseGrepMatches, formatGrepMatches, formatGrepOutput } from './grep-core.ts'
export type { GrepToolCaps, GrepInput } from './grep-core.ts'

/**
 * Pending-call presentation: a search card titled by the pattern (and target /
 * include filter).
 *
 * @param args - the raw tool arguments; `pattern`, `path`, and `include` feed the title.
 * @returns the generic card view (`kind: 'search'`) shown while the call runs.
 */
export function presentGrepCall(args: { pattern: string; path?: string; include?: string }): GenericCallView {
  const where = args.path !== undefined ? ` in ${args.path}` : ''
  const filter = args.include !== undefined ? ` (${args.include})` : ''
  return { card: 'generic', title: `Grep ${args.pattern}${where}${filter}`, kind: 'search', rawInput: args.pattern }
}

/**
 * Completed-call presentation: the search card projected from the result's
 * `presentationMeta` (matches grouped by file, with the truncation signal). A UI
 * without a search card falls back to the raw `tool/result` content, so the view
 * carries no result text of its own. Malformed or absent metadata (an obsolete or
 * hand-edited replayed log) falls back to the generic card.
 *
 * @param _args - the raw tool arguments; unused, the view derives from the result.
 * @param result - the final model-facing tool result carrying the projected metadata.
 * @returns the search card view, or `undefined` for the generic fallback.
 */
export function presentGrepResult(
  _args: { pattern: string; path?: string; include?: string },
  result: ToolResult,
): SearchResultView | undefined {
  if (result.isError) return undefined
  const view = searchViewFromMeta(result.meta)
  if (view === undefined || view.shape !== 'matches') return undefined
  return view
}

/**
 * Register the `grep` tool and its scope-aware system-prompt guidance.
 *
 * @param ctx - the plugin context; registrations are effects scoped to it, and
 *   execution uses its `subprocess` service.
 * @param caps - the deployment's resolved grep caps (plugin config after defaulting).
 */
export function applyGrepTool(ctx: Context, caps: GrepToolCaps): void {
  ctx.systemPrompt.section({
    name: 'tool:grep',
    order: ctx.systemPrompt.getSectionOrder('TOOL_GREP'),
    text: ({ scope }) => ctx.tools.get('grep', scope) === undefined
      ? ''
      : 'Use the grep tool — not shell grep or rg — to search file contents.'
        + (ctx.tools.get('read', scope) === undefined ? '' : ' Use read on a matched file when you need surrounding context.'),
  })

  const tool = defineTool({
    name: 'grep',
    description: 'Search file contents with a ripgrep regular expression. Returns matching lines with line numbers, grouped by file. '
      + `Returns the first ${caps.maxMatches} matches inline; a capped result reports where the complete match list was saved. `
      + 'Use read on a matched file for surrounding context.',
    parameters: {
      pattern: { type: 'string', required: true, description: 'Regular expression to search for (ripgrep syntax).' },
      path: { type: 'string', description: 'File or directory to search. Defaults to the session workspace; a relative path resolves against it.' },
      include: { type: 'string', description: 'One glob filter for which files to search (e.g. "*.ts", "*.{js,jsx}"). Not a list; negation is not supported.' },
    },
    timeoutMs: caps.timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          matches: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                lineNumber: { type: 'integer', required: true },
                line: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: formatRetainedGrep(retainGrepMatches(value.matches, caps.maxMatches, caps.maxLineBytes)),
      }],
      presentationMeta: (_args, value) =>
        grepSearchMeta(retainGrepMatches(value.matches, caps.maxMatches, caps.maxLineBytes), caps.maxMetaBytes),
    },
    async execute(args, exec) {
      const input = parseGrepArgs(args)
      const run = await runRipgrep(ctx, exec, 'grep', buildGrepCommand(input), caps.rawOutputMaxBytes, caps.graceMs, caps.stderrMaxBytes)
      if (run.noMatches) return { matches: [] }

      const all: GrepMatch[] = []
      for (const raw of parseGrepMatches(run.stdout)) {
        const match: GrepMatch = {
          path: toWorkdirRelative(raw.path, run.workdir),
          lineNumber: raw.lineNumber,
          line: raw.line,
        }
        all.push(match)
      }
      return { matches: all }
    },
    presentCall: presentGrepCall,
    presentResult: presentGrepResult,
  })
  ctx.tools.register(tool)

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    const value = acceptedDirectCallValue(ctx, tool, exec, result, decision) as { matches: GrepMatch[] } | undefined
    if (value === undefined) return decision
    const matches = value.matches
    if (matches.length <= caps.maxMatches) return decision
    // The spill artifact holds the COMPLETE result: preview each line, but keep
    // every match (no inline cap), so the recovery file is the full search.
    const previewedAll = matches.map(match => ({ ...match, line: previewLine(match.line, caps.maxLineBytes) }))
    const spillRef = await trySaveFormattedResult(
      ctx,
      exec,
      'grep-results.txt',
      `Found ${matches.length} ${matchNoun(matches.length)}\n\n${formatGrepMatches(previewedAll)}`,
    )
    return {
      kind: 'accept',
      content: [{
        type: 'text',
        text: formatRetainedGrep(retainGrepMatches(matches, caps.maxMatches, caps.maxLineBytes), spillRef),
      }],
      ...decision.additionalContexts !== undefined ? { additionalContexts: decision.additionalContexts } : {},
    }
  })
}
