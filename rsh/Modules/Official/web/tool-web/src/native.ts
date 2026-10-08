/**
 * Native installation of the model-facing `web_search` and `web_fetch` tools. Both entries call the
 * same framework-free core (argument validation, query fan-out and merge, rendering, presentation
 * meta, prompt guidance); this module only binds that core to the native tool and prompt registries.
 * Call-deadline enforcement belongs to the tool-call timeout guard, exactly as on the Cordis path,
 * so the tools honor the invocation signal and do not arm their own timer.
 * @module @deepseek-ai/dsh-tool-web/native
 */

import type { NativePlugin, NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type { NativeValueToolContribution } from '@deepseek-ai/dsh-native-tools'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import type {} from '@deepseek-ai/dsh-native-prompt/native'
import type { NativeWebService } from '@deepseek-ai/dsh-web/native'
import {
  Config,
  assertToolWebLimits,
  type ResolvedConfig,
} from './config.ts'
import {
  fetchMetaFromValue,
  fetchOutputValue,
  formatFetchOutput,
  parseFetchArgs,
  WEB_FETCH_DESCRIPTION,
  WEB_FETCH_URL_DESCRIPTION,
  webFetchGuidance,
  type WebFetchMeta,
} from './fetch-core.ts'
import {
  formatSearchOutput,
  parseSearchArgs,
  runSearchQueries,
  searchMetaFromValue,
  searchOutputValue,
  webSearchDescription,
  webSearchGuidance,
  webSearchQueriesDescription,
  type WebSearchMeta,
} from './search-core.ts'

/** Model-facing `web_search` over the selected native web service. */
function searchTool(web: NativeWebService, config: ResolvedConfig): NativeValueToolContribution {
  const { searchMaxResults: maxResults, searchMaxQueries: maxQueries, searchTimeoutMs: timeoutMs } = config
  return {
    timeoutMs,
    schema: {
      name: 'web_search', description: webSearchDescription(maxQueries),
      parameters: {
        // Byte-identical to the Cordis definition's model-visible parameters.
        type: 'object',
        properties: { queries: { type: 'array', description: webSearchQueriesDescription(maxQueries), items: { type: 'string' } } },
        required: ['queries'],
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          content: { type: 'string' },
          sources: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                url: { type: 'string' }, title: { type: 'string' },
                snippet: { type: 'string' }, publishedAt: { type: 'string' },
              },
              required: ['url'],
            },
          },
          truncated: { type: 'boolean' },
        },
        required: ['sources', 'truncated'],
      },
      render(_call, value) {
        const result = value as unknown as Parameters<typeof formatSearchOutput>[0]
        return {
          isError: false, content: [{ type: 'text', text: formatSearchOutput(result) }],
          meta: searchMetaFromValue(result),
        }
      },
    },
    isConcurrencySafe: () => true,
    execute: async call => searchOutputValue(await runSearchQueries(
      { search: (request, signal) => web.search(request, { signal, appendEvent: call.appendEvent }) },
      parseSearchArgs(call.arguments as { queries: string[] }, maxQueries), maxResults, call.signal)),
  }
}

/** Model-facing `web_fetch` over the selected native web service. */
function fetchTool(web: NativeWebService, config: ResolvedConfig): NativeValueToolContribution {
  const { fetchMaxOutputChars: maxOutputChars, fetchTimeoutMs: timeoutMs } = config
  return {
    timeoutMs,
    schema: {
      name: 'web_fetch', description: WEB_FETCH_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: WEB_FETCH_URL_DESCRIPTION } },
        required: ['url'],
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          url: { type: 'string' }, statusCode: { type: 'integer' },
          body: {
            oneOf: (['html', 'text'] as const).map(kind => ({
              type: 'object' as const, additionalProperties: false,
              properties: { kind: { type: 'string' as const, const: kind }, content: { type: 'string' as const } },
              required: ['kind', 'content'],
            })),
          },
          truncated: { type: 'boolean' },
        },
        required: ['url', 'statusCode', 'body', 'truncated'],
      },
      render(_call, value) {
        const result = value as unknown as Parameters<typeof formatFetchOutput>[0]
        return {
          isError: false, content: [{ type: 'text', text: formatFetchOutput(result, maxOutputChars) }],
          meta: fetchMetaFromValue(result, maxOutputChars),
        }
      },
    },
    isConcurrencySafe: () => true,
    execute: async call => fetchOutputValue(await web.fetch(
      { url: parseFetchArgs(call.arguments as { url: string }).url }, { signal: call.signal, appendEvent: call.appendEvent })),
  }
}

/**
 * Validate native configuration with the Cordis schema and reject fields it does not declare.
 * @param input - untrusted profile configuration.
 * @returns the validated, fully defaulted configuration.
 */
function resolveConfig(input: unknown): ResolvedConfig {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    throw new TypeError('tool-web: native configuration must be an object')
  }
  for (const key of Object.keys(input ?? {})) {
    if (Config.dict === undefined || !Object.hasOwn(Config.dict, key)) {
      throw new TypeError(`tool-web: unknown native configuration field ${key}`)
    }
  }
  const resolved = Config(input ?? {}) as ResolvedConfig
  assertToolWebLimits(resolved)
  return resolved
}

/** Register the enabled web tools and their scope-aware prompt guidance. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-tool-web', targets: ['host'], requires: ['tools', 'web'],
  optional: ['promptSections'], provides: [],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      const tools = context.require('tools')
      const web = context.require('web')
      const registered = [
        ...config.search ? [searchTool(web, config)] : [],
        ...config.fetch ? [fetchTool(web, config)] : [],
      ]
      for (const tool of registered) context.effect(tools.registerValueTool(tool, context.scope))
      const sections = context.optional('promptSections')
      if (sections === undefined) return
      const visible = (scope: NativeScope, name: string) => tools.schemas(scope).some(tool => tool.name === name)
      if (config.search) context.effect(sections.register({
        name: 'tool:web_search', order: 2000,
        text: scope => visible(scope, 'web_search') ? webSearchGuidance(config.searchMaxQueries, config.fetch && visible(scope, 'web_fetch')) : '',
      }, context.scope))
      if (config.fetch) context.effect(sections.register({
        name: 'tool:web_fetch', order: 2100,
        text: scope => visible(scope, 'web_fetch') ? webFetchGuidance(visible(scope, 'web_search')) : '',
      }, context.scope))
    }
  },
}

export type { WebFetchMeta, WebSearchMeta }
