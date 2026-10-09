/**
 * Cordis registration of the model-facing `web_fetch` tool. Schema, validation, and presentation
 * live in the framework-free core; this module only binds them to the Cordis registries.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolResult, WebFetchResultView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-web'
import {
  fetchMetaFromResult, fetchMetaFromValue, fetchOutputValue, formatFetchOutput, parseFetchArgs,
  WEB_FETCH_DESCRIPTION, WEB_FETCH_URL_DESCRIPTION, webFetchGuidance,
} from './fetch-core.ts'

/**
 * Pending-call presentation: a fetch card titled by the URL.
 *
 * @param args - the raw tool arguments; only `url` feeds the view.
 * @returns the generic card view (`kind: 'fetch'`) shown while the call runs.
 */
export function presentFetchCall(args: { url: string }): GenericCallView {
  return { card: 'generic', title: args.url, kind: 'fetch', rawInput: args.url }
}

/**
 * Completed-call presentation: a `web` fetch card carrying the retrieval summary
 * from `meta`. It sets no `content` copy — a UI without the `web` capability
 * falls back to the raw `tool/result` content, the already-markdown body (see the
 * web-result-card Agent Note).
 *
 * @param args - the raw tool arguments; `url` becomes the result-state title so a
 *   window-truncated replay that dropped the call head still has one.
 * @param result - the final model-facing tool result; `meta` carries the summary.
 * @returns the fetch result view, or `undefined` (generic card) on failure or
 *   malformed meta.
 */
export function presentFetchResult(args: { url: string }, result: ToolResult): WebFetchResultView | undefined {
  if (result.isError) return undefined
  const meta = fetchMetaFromResult(result.meta)
  if (meta === undefined) return undefined
  return {
    card: 'web',
    kind: 'fetch',
    title: args.url,
    url: meta.url,
    statusCode: meta.statusCode,
    truncated: meta.truncated,
  }
}

/**
 * Register the `web_fetch` tool and its scope-aware system-prompt guidance.
 *
 * @param ctx - context whose `tools` and `systemPrompt` registries receive the
 *   registrations; both are effect-scoped and unregister on plugin dispose.
 * @param timeoutMs - the cooperative tool-call budget (ms) attached as the tool's
 *   `ToolDefinition.timeoutMs` for `@deepseek-ai/dsh-tool-call-timeout-policy` to enforce.
 * @param maxOutputChars - cap on the complete rendered tool output (see
 *   {@link formatFetchOutput}) and on source characters converted synchronously.
 */
export function applyWebFetchTool(ctx: Context, timeoutMs: number, maxOutputChars: number): void {
  ctx.systemPrompt.section({
    name: 'tool:web_fetch',
    order: ctx.systemPrompt.getSectionOrder('TOOL_WEB_FETCH'),
    text: ({ scope }) => ctx.tools.get('web_fetch', scope) === undefined
      ? ''
      : webFetchGuidance(ctx.tools.get('web_search', scope) !== undefined),
  })

  ctx.tools.register(defineTool({
    name: 'web_fetch',
    description: WEB_FETCH_DESCRIPTION,
    parameters: {
      url: { type: 'string', required: true, description: WEB_FETCH_URL_DESCRIPTION },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          statusCode: { type: 'integer', required: true },
          body: {
            required: true,
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string', required: true, const: 'html' },
                  content: { type: 'string', required: true },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string', required: true, const: 'text' },
                  content: { type: 'string', required: true },
                },
              },
            ],
          },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatFetchOutput(value, maxOutputChars) }],
      presentationMeta: (_args, value) => fetchMetaFromValue(value, maxOutputChars),
    },
    timeoutMs,
    // Provider reads do not mutate parent-agent state.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseFetchArgs(args)
      return fetchOutputValue(await ctx.web.fetch({ url: input.url }, exec.signal))
    },
    presentCall: presentFetchCall,
    presentResult: (args, result) => presentFetchResult(args, result),
  }))
}
