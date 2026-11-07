/**
 * Native installation of the model-facing `lsp` tool.
 *
 * Argument checks, coordinate conversion, result caps, and rendering stay in the Cordis module.
 * This entry binds that core to the native tool registry and the native LSP service. The session
 * workspace is the invocation session's cwd. Call-deadline enforcement belongs to the tool-call
 * timeout guard, which reads `timeoutMs`.
 * @module @redspark/rsh-tool-lsp/native
 */

import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { NativeValueToolContribution } from '@redspark/rsh-native-tools'
import type { JsonSchemaNode } from '@redspark/rsh-native-tools/json-schema'
import type {} from '@redspark/rsh-native-tools/native'
import type {} from '@redspark/rsh-native-prompt/native'
import { LspError } from '@redspark/rsh-lsp/native'
import type { LspQueryResult, LspService } from '@redspark/rsh-lsp/native'
import {
  Config,
  LSP_PROMPT_TEXT,
  validateToolLspConfig,
  type Config as ToolLspConfig,
} from './config.ts'
import {
  formatHover,
  formatLocations,
  LSP_OPERATIONS,
  parseLspArgs,
  type LspToolArgs,
} from './render.ts'

/** Prompt order of `TOOL_LSP` in the Cordis system-prompt table. */
const TOOL_LSP_PROMPT_ORDER = 2200

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices { lsp: LspService }
}

const POSITION_SCHEMA: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  properties: {
    line: { type: 'integer' },
    character: { type: 'integer' },
  },
  required: ['line', 'character'],
}

const RANGE_SCHEMA: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  properties: {
    start: POSITION_SCHEMA,
    end: POSITION_SCHEMA,
  },
  required: ['start', 'end'],
}

const OUTPUT_SCHEMA: JsonSchemaNode = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'locations' },
        locations: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              uri: { type: 'string' },
              range: RANGE_SCHEMA,
            },
            required: ['uri', 'range'],
          },
        },
        resolvedWorkspaceUri: { type: 'string' },
      },
      required: ['kind', 'locations', 'resolvedWorkspaceUri'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'hover' },
        hover: {
          oneOf: [
            { type: 'null' },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                contents: { type: 'string' },
                range: RANGE_SCHEMA,
              },
              required: ['contents'],
            },
          ],
        },
      },
      required: ['kind', 'hover'],
    },
  ],
}

type ResolvedConfig = Required<ToolLspConfig>

/** Fill schema defaults, then reject a cap or timeout the runtime cannot honor. */
function resolveConfig(input: unknown): ResolvedConfig {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    throw new TypeError('tool-lsp: native configuration must be an object')
  }
  const record = (input ?? {}) as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (key !== 'maxLocations' && key !== 'maxResultChars' && key !== 'timeoutMs') {
      throw new TypeError(`tool-lsp: unknown native configuration field ${key}`)
    }
  }
  const resolved = Config(record) as ResolvedConfig
  validateToolLspConfig(resolved)
  return resolved
}

/** Copy one seam result into the canonical JSON value the registry validates. */
function canonicalResult(result: LspQueryResult): LspQueryResult {
  if (result.kind === 'locations') {
    return {
      kind: 'locations',
      resolvedWorkspaceUri: result.resolvedWorkspaceUri,
      locations: result.locations.map(location => ({
        uri: location.uri,
        range: {
          start: { line: location.range.start.line, character: location.range.start.character },
          end: { line: location.range.end.line, character: location.range.end.character },
        },
      })),
    }
  }
  if (result.hover === null) return { kind: 'hover', hover: null }
  const range = result.hover.range
  return {
    kind: 'hover',
    hover: {
      contents: result.hover.contents,
      ...range === undefined ? {} : {
        range: {
          start: { line: range.start.line, character: range.start.character },
          end: { line: range.end.line, character: range.end.character },
        },
      },
    },
  }
}

/** Model-facing `lsp` tool over the selected native LSP service. */
function lspTool(lsp: LspService, config: ResolvedConfig): NativeValueToolContribution {
  return {
    timeoutMs: config.timeoutMs,
    schema: {
      name: 'lsp',
      description:
        'Query a language server for precise code navigation. operation is one of goToDefinition, findReferences, goToImplementation, hover. line and character are one-based UTF-16 cursor coordinates. findReferences includes the declaration.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          operation: {
            type: 'string',
            enum: [...LSP_OPERATIONS],
            description: 'goToDefinition, findReferences, goToImplementation, or hover.',
          },
          file_path: { type: 'string', description: 'The source file to query, relative to the workspace or absolute.' },
          line: { type: 'integer', description: 'One-based line of the cursor.' },
          character: { type: 'integer', description: 'One-based UTF-16 column of the cursor.' },
        },
        required: ['operation', 'file_path', 'line', 'character'],
      },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render(_call, value) {
        const result = value as unknown as LspQueryResult
        const text = result.kind === 'locations'
          ? formatLocations(result.locations, result.resolvedWorkspaceUri, config.maxLocations, config.maxResultChars)
          : formatHover(result.hover, config.maxResultChars)
        return { isError: false, content: [{ type: 'text', text }] }
      },
    },
    async execute(call) {
      const input = parseLspArgs(call.arguments as LspToolArgs)
      const workspaceRoot = call.session.header.cwd
      if (workspaceRoot === undefined) {
        throw new LspError('the lsp tool requires a session workspace cwd', 'LSP_WORKSPACE_REQUIRED')
      }
      const result = await lsp.query({
        operation: input.operation,
        filePath: input.filePath,
        position: input.position,
        workspaceRoot,
      }, call.signal)
      return canonicalResult(result)
    },
  }
}

/** Register the `lsp` tool and its system-prompt guidance. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-tool-lsp',
  targets: ['host'],
  requires: ['tools', 'lsp', 'promptSections'],
  optional: [],
  provides: [],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      const tools = context.require('tools')
      const lsp = context.require('lsp')
      context.effect(tools.registerValueTool(lspTool(lsp, config), context.scope))
      context.effect(context.require('promptSections').register({
        name: 'tool:lsp',
        order: TOOL_LSP_PROMPT_ORDER,
        text: () => LSP_PROMPT_TEXT,
      }, context.scope))
    }
  },
}
