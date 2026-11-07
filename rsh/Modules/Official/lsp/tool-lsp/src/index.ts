/**
 * Model-facing `lsp` tool over `ctx.lsp`. One read-only tool with four operations
 * (`goToDefinition`/`findReferences`/`goToImplementation`/`hover`); it converts one-based UTF-16
 * cursor coordinates to the seam's zero-based positions, requires the session workspace with no
 * fallback, caps and renders results, and attaches a configurable timeout budget for
 * `dsh-tool-call-timeout-policy` to enforce. It runtime-injects only `tools`, `lsp`, and `systemPrompt` and
 * imports no provider.
 *
 * Namespace plugin (named exports, no default export).
 * @module @redspark/rsh-tool-lsp
 */

import type { Context } from '@redspark/cordis'
import { defineTool } from '@redspark/rsh-tools'
import { LspError } from '@redspark/rsh-lsp'
import type {} from '@redspark/rsh-lsp'
import { assertNever } from '@redspark/rsh-util-values'
import {
  Config,
  LSP_PROMPT_TEXT,
  validateToolLspConfig,
} from './config.ts'
import {
  formatHover,
  formatLocations,
  LSP_OPERATIONS,
  parseLspArgs,
  presentLspCall,
} from './render.ts'
import { sessionCwd } from './session-cwd.ts'

export {
  DEFAULT_MAX_LOCATIONS,
  DEFAULT_MAX_RESULT_CHARS,
  formatHover,
  formatLocations,
  LSP_OPERATIONS,
  parseLspArgs,
  presentLspCall,
  renderUri,
} from './render.ts'
export { sessionCwd } from './session-cwd.ts'
export {
  Config,
  DEFAULT_LSP_TOOL_TIMEOUT_MS,
  LSP_PROMPT_TEXT,
  validateToolLspConfig,
} from './config.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'tool-lsp'

/** Services required by this plugin. */
export const inject = ['tools', 'lsp', 'systemPrompt']

type ResolvedConfig = Required<Config>

const LSP_POSITION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    line: { type: 'integer', required: true },
    character: { type: 'integer', required: true },
  },
} as const

const LSP_RANGE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    start: { ...LSP_POSITION_OUTPUT_SCHEMA, required: true },
    end: { ...LSP_POSITION_OUTPUT_SCHEMA, required: true },
  },
} as const

/**
 * Register the `lsp` tool and its system-prompt guidance.
 * @param ctx - the plugin context (must inject `tools`, `lsp`, `systemPrompt`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  validateToolLspConfig(resolved)

  ctx.systemPrompt.section({
    name: 'tool:lsp',
    order: ctx.systemPrompt.getSectionOrder('TOOL_LSP'),
    text: LSP_PROMPT_TEXT,
  })

  ctx.tools.register(defineTool({
    name: 'lsp',
    description:
      'Query a language server for precise code navigation. operation is one of goToDefinition, findReferences, goToImplementation, hover. line and character are one-based UTF-16 cursor coordinates. findReferences includes the declaration.',
    parameters: {
      operation: {
        type: 'string',
        required: true,
        enum: [...LSP_OPERATIONS],
        description: 'goToDefinition, findReferences, goToImplementation, or hover.',
      },
      file_path: { type: 'string', required: true, description: 'The source file to query, relative to the workspace or absolute.' },
      line: { type: 'number', required: true, description: 'One-based line of the cursor.' },
      character: { type: 'number', required: true, description: 'One-based UTF-16 column of the cursor.' },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'locations' },
              locations: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    uri: { type: 'string', required: true },
                    range: { ...LSP_RANGE_OUTPUT_SCHEMA, required: true },
                  },
                },
              },
              resolvedWorkspaceUri: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'hover' },
              hover: {
                required: true,
                oneOf: [
                  { type: 'null' },
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      contents: { type: 'string', required: true },
                      range: LSP_RANGE_OUTPUT_SCHEMA,
                    },
                  },
                ],
              },
            },
          },
        ],
      },
      render: (_args, value) => {
        switch (value.kind) {
          case 'locations':
            return [{ type: 'text', text: formatLocations(value.locations, value.resolvedWorkspaceUri, resolved.maxLocations, resolved.maxResultChars) }]
          case 'hover':
            return [{ type: 'text', text: formatHover(value.hover, resolved.maxResultChars) }]
          /* v8 ignore next -- exhaustive over the output schema's closed union; unreachable. */
          default:
            return assertNever(value, 'tool-lsp output')
        }
      },
    },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const input = parseLspArgs(args)
      const workspaceRoot = sessionCwd(exec)
      if (workspaceRoot === undefined) {
        throw new LspError('the lsp tool requires a session workspace cwd', 'LSP_WORKSPACE_REQUIRED')
      }
      const result = await ctx.lsp.query({
        operation: input.operation,
        filePath: input.filePath,
        position: input.position,
        workspaceRoot,
      }, exec.signal)
      switch (result.kind) {
        case 'locations':
          return {
            kind: 'locations' as const,
            locations: result.locations.map(location => ({
              uri: location.uri,
              range: {
                start: { line: location.range.start.line, character: location.range.start.character },
                end: { line: location.range.end.line, character: location.range.end.character },
              },
            })),
            resolvedWorkspaceUri: result.resolvedWorkspaceUri,
          }
        case 'hover':
          return {
            kind: 'hover' as const,
            hover: result.hover === null
              ? null
              : {
                contents: result.hover.contents,
                ...result.hover.range === undefined
                  ? {}
                  : {
                    range: {
                      start: { line: result.hover.range.start.line, character: result.hover.range.start.character },
                      end: { line: result.hover.range.end.line, character: result.hover.range.end.character },
                    },
                  },
              },
          }
        /* v8 ignore next -- exhaustive over the closed LspQueryResult union; unreachable. */
        default:
          return assertNever(result, 'tool-lsp result')
      }
    },
    presentCall: presentLspCall,
  }))
}
