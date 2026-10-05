/** Native glob and grep Consumers over selected subprocess and optional formatted-result storage. */
import { z } from 'zod'
import type { NativeContext, NativePlugin, NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type { NativeToolExecution, NativeValueToolContribution } from '@deepseek-ai/dsh-native-tools'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import type {} from '@deepseek-ai/dsh-native-prompt/native'
import type { SpillRef } from '@deepseek-ai/dsh-spill/native'
import type {} from '@deepseek-ai/dsh-subprocess/native'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { GLOB_MAX_RESULTS, globDescription, globGuidance, GLOB_PATTERN_DESCRIPTION, buildGlobCommand, globCardPage, parseGlobArgs, renderGlobPaths } from './glob-core.ts'
import { GREP_MAX_LINE_BYTES, GREP_MAX_MATCHES, buildGrepCommand, formatGrepMatches, formatRetainedGrep,
  matchNoun, parseGrepArgs, parseGrepMatches } from './grep-core.ts'
import { globSearchMeta, grepSearchMeta } from './presentation.ts'
import { RAW_OUTPUT_MAX_BYTES, SEARCH_GRACE_MS, SEARCH_META_MAX_BYTES, SEARCH_STDERR_MAX_BYTES,
  SEARCH_TIMEOUT_MS, previewLine, retainGrepMatches, runRipgrep, toWorkdirRelative, type GrepMatch } from './ripgrep-core.ts'

const configSchema = z.object({
  sampleOverCapGlobResults: z.boolean(),
  globMaxResults: z.number().int().positive().default(GLOB_MAX_RESULTS),
  grepMaxMatches: z.number().int().positive().default(GREP_MAX_MATCHES),
  grepMaxLineBytes: z.number().int().positive().default(GREP_MAX_LINE_BYTES),
  searchMetaMaxBytes: z.number().int().positive().default(SEARCH_META_MAX_BYTES),
  rawOutputMaxBytes: z.number().int().positive().default(RAW_OUTPUT_MAX_BYTES),
  graceMs: z.number().int().positive().max(MAX_TIMER_DELAY_MS).default(SEARCH_GRACE_MS),
  stderrMaxBytes: z.number().int().positive().default(SEARCH_STDERR_MAX_BYTES),
  timeoutMs: z.number().int().positive().max(MAX_TIMER_DELAY_MS).default(SEARCH_TIMEOUT_MS),
}).strict()
type Config = z.infer<typeof configSchema>

async function search(context: NativeContext, call: NativeToolExecution, argv: readonly string[], caps: Config) {
  const timeout = new AbortController()
  const timer = setTimeout(() => { timeout.abort() }, caps.timeoutMs)
  const cwd = call.session.header.cwd
  try {
    return await runRipgrep(context.require('subprocess'), {
      signal: AbortSignal.any([call.signal, timeout.signal]), ...cwd === undefined ? {} : { cwd },
    }, call.name, argv, caps.rawOutputMaxBytes, caps.graceMs, caps.stderrMaxBytes)
  } finally { clearTimeout(timer) }
}

async function save(context: NativeContext, call: NativeToolExecution, name: string, content: string): Promise<SpillRef | undefined> {
  const store = context.optional('spillStore')
  if (store === undefined) {
    console.warn(`tool-fs-search: no spillStore backend loaded; complete ${call.name} result not saved`)
    return undefined
  }
  try {
    return await store.saveText({ owner: { sessionId: call.session.header.id },
      source: { kind: 'tool', toolName: call.name, callId: call.callId, label: 'result' },
      suggestedName: name, content }, call.signal)
  } catch (error: unknown) {
    call.signal.throwIfAborted()
    console.warn(`tool-fs-search: saveText failed for ${call.name}: ${String(error)}; complete result not saved`)
    return undefined
  }
}

function globTool(context: NativeContext, config: Config): NativeValueToolContribution {
  const caps = { ...config, maxResults: config.globMaxResults, maxMetaBytes: config.searchMetaMaxBytes }
  return {
    schema: { name: 'glob', description: globDescription(caps),
      parameters: { type: 'object', properties: {
        pattern: { type: 'string', description: GLOB_PATTERN_DESCRIPTION },
        path: { type: 'string', description: 'Directory to search in. Defaults to the session workspace; a relative path resolves against it.' },
      }, required: ['pattern'], additionalProperties: false } },
    output: {
      schema: { type: 'object', properties: { root: { type: 'string' },
        paths: { type: 'array', items: { type: 'string' } } }, required: ['root', 'paths'], additionalProperties: false },
      render(_call, value) {
        const { root, paths } = value as { root: string; paths: string[] }
        const page = globCardPage(paths, caps, root)
        return { isError: false, content: [{ type: 'text', text: renderGlobPaths(paths, caps, root) }],
          meta: globSearchMeta({ ...page, seen: paths.length }, caps.maxMetaBytes) }
      },
    },
    async execute(call) {
      const input = parseGlobArgs(call.arguments as { pattern: string; path?: string })
      const run = await search(context, call, buildGlobCommand(input), config)
      return { root: input.path === undefined ? '.' : toWorkdirRelative(input.path, run.workdir),
        paths: run.noMatches ? [] : run.stdout.split('\n').filter(line => line.length > 0)
          .map(path => toWorkdirRelative(path, run.workdir)) }
    },
    async finalizeResult(call, original, selected) {
      if (call.parent !== undefined || selected.isError || selected.value !== original.value
        || selected.content !== original.content || original.value === undefined) return selected
      const { root, paths } = original.value as { root: string; paths: string[] }
      if (paths.length <= caps.maxResults) return selected
      const spill = await save(context, call, 'glob-results.txt', paths.join('\n'))
      return { ...selected, content: [{ type: 'text', text: renderGlobPaths(paths, caps, root, spill) }] }
    },
  }
}

function grepTool(context: NativeContext, caps: Config): NativeValueToolContribution {
  const retained = (matches: GrepMatch[]) => retainGrepMatches(matches, caps.grepMaxMatches, caps.grepMaxLineBytes)
  return {
    schema: { name: 'grep', description: 'Search file contents with a ripgrep regular expression. Returns matching lines with line numbers, grouped by file. '
      + `Returns the first ${caps.grepMaxMatches} matches inline; a capped result reports where the complete match list was saved. `
      + 'Use read on a matched file for surrounding context.',
    parameters: { type: 'object', properties: {
      pattern: { type: 'string', description: 'Regular expression to search for (ripgrep syntax).' },
      path: { type: 'string', description: 'File or directory to search. Defaults to the session workspace; a relative path resolves against it.' },
      include: { type: 'string', description: 'One glob filter for which files to search (e.g. "*.ts", "*.{js,jsx}"). Not a list; negation is not supported.' },
    }, required: ['pattern'], additionalProperties: false } },
    output: {
      schema: { type: 'object', properties: { matches: { type: 'array', items: {
        type: 'object', properties: { path: { type: 'string' }, lineNumber: { type: 'integer' }, line: { type: 'string' } },
        required: ['path', 'lineNumber', 'line'], additionalProperties: false,
      } } }, required: ['matches'], additionalProperties: false },
      render(_call, value) {
        const page = retained((value as unknown as { matches: GrepMatch[] }).matches)
        return { isError: false, content: [{ type: 'text', text: formatRetainedGrep(page) }],
          meta: grepSearchMeta(page, caps.searchMetaMaxBytes) }
      },
    },
    async execute(call) {
      const input = parseGrepArgs(call.arguments as { pattern: string; path?: string; include?: string })
      const run = await search(context, call, buildGrepCommand(input), caps)
      return { matches: run.noMatches ? [] : parseGrepMatches(run.stdout)
        .map(match => ({ ...match, path: toWorkdirRelative(match.path, run.workdir) })) }
    },
    async finalizeResult(call, original, selected) {
      if (call.parent !== undefined || selected.isError || selected.value !== original.value
        || selected.content !== original.content || original.value === undefined) return selected
      const { matches } = original.value as unknown as { matches: GrepMatch[] }
      if (matches.length <= caps.grepMaxMatches) return selected
      const all = matches.map(match => ({ ...match, line: previewLine(match.line, caps.grepMaxLineBytes) }))
      const spill = await save(context, call, 'grep-results.txt',
        `Found ${matches.length} ${matchNoun(matches.length)}\n\n${formatGrepMatches(all)}`)
      return { ...selected, content: [{ type: 'text', text: formatRetainedGrep(retained(matches), spill) }] }
    },
  }
}

/** Each tool and its scope-aware prompt guidance drains before the selected process and storage Providers. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-tool-fs-search', targets: ['host'], requires: ['tools', 'subprocess'],
  optional: ['promptSections', 'spillStore'], provides: [],
  resolve(input) {
    const config = configSchema.parse(input)
    return (context) => {
      const tools = context.require('tools')
      for (const tool of [globTool(context, config), grepTool(context, config)]) {
        context.effect(tools.registerValueTool(tool, context.scope))
      }
      const sections = context.optional('promptSections')
      if (sections !== undefined) {
        const visible = (scope: NativeScope, name: string) => tools.schemas(scope).some(tool => tool.name === name)
        context.effect(sections.register({ name: 'tool:glob', order: 1400, text: scope => visible(scope, 'glob')
          ? globGuidance({ ...config, maxResults: config.globMaxResults, maxMetaBytes: config.searchMetaMaxBytes }) : '' }, context.scope))
        context.effect(sections.register({ name: 'tool:grep', order: 1500, text: scope => visible(scope, 'grep')
          ? 'Use the grep tool — not shell grep or rg — to search file contents.'
            + (visible(scope, 'read') ? ' Use read on a matched file when you need surrounding context.' : '') : '' }, context.scope))
      }
    }
  },
}
