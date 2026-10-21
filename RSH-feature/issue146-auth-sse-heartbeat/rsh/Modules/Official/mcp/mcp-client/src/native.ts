/** Native MCP installation over the shared connection supervisor and protocol bridge. */
import type { NativeContext, NativePlugin, NativeScope, ResourceOwner } from '@deepseek-ai/dsh-native-runtime'
import type { NativeToolExecution, NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import type { AttachmentOperations } from '@deepseek-ai/dsh-attachment/native'
import type { NativeModel } from '@deepseek-ai/dsh-native-model-execution'
export type {} from '@deepseek-ai/dsh-native-tools/native'
export type {} from '@deepseek-ai/dsh-attachment/native'
export type {} from '@deepseek-ai/dsh-native-model-execution/native'
import type { Config } from './types.ts'
import { resolveReconnectPolicy, startConnection, type McpConnectionPorts } from './connection-core.ts'
import { syncTools } from './tool-core.ts'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
export type { Config, StdioConfig, StreamableHttpConfig, McpResult } from './types.ts'

const namespaces = new WeakMap<object, Map<NativeScope, Set<string>>>()

/**
 * Validate a complete native deployment configuration without Cordis normalization.
 * @param input - explicit transport, namespace and call controls.
 * @returns validated transport configuration.
 */
export function resolveNativeMcpConfig(input: unknown): Config {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('mcp-client: configuration must be an object')
  const config = input as Record<string, unknown>
  if (typeof config.serverName !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(config.serverName)) {
    throw new Error('mcp-client: serverName must match [A-Za-z0-9_-]{1,32}')
  }
  if (typeof config.toolCallTimeoutMs !== 'number' || !Number.isSafeInteger(config.toolCallTimeoutMs)
    || config.toolCallTimeoutMs < 1 || config.toolCallTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error('mcp-client: toolCallTimeoutMs must be a positive timer-sized integer')
  }
  if (typeof config.failOnStartupError !== 'boolean') throw new Error('mcp-client: failOnStartupError must be explicit')
  const keys = config.transport === 'stdio'
    ? ['transport', 'serverName', 'toolCallTimeoutMs', 'failOnStartupError', 'reconnect', 'command', 'args', 'env', 'cwd']
    : ['transport', 'serverName', 'toolCallTimeoutMs', 'failOnStartupError', 'reconnect', 'url', 'headers']
  for (const key of Object.keys(config)) if (!keys.includes(key)) throw new Error(`mcp-client: unknown configuration field ${key}`)
  const common = { serverName: config.serverName, toolCallTimeoutMs: config.toolCallTimeoutMs,
    failOnStartupError: config.failOnStartupError,
    reconnect: resolveReconnectPolicy(config.reconnect, 'mcp-client: reconnect') }
  const dictionary = (value: unknown, field: string): Record<string, string> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)
      || Object.values(value).some(item => typeof item !== 'string')) throw new Error(`mcp-client: ${field} must contain strings`)
    return { ...value }
  }
  if (config.transport === 'stdio') {
    if (typeof config.command !== 'string' || config.command.length === 0 || typeof config.cwd !== 'string'
      || !Array.isArray(config.args) || config.args.some(item => typeof item !== 'string')) {
      throw new Error('mcp-client: stdio requires command, args and cwd')
    }
    return { ...common, transport: 'stdio', command: config.command, cwd: config.cwd,
      args: [...config.args as unknown[]] as string[], env: dictionary(config.env, 'env') }
  }
  if (config.transport === 'streamable-http') {
    if (typeof config.url !== 'string') throw new Error('mcp-client: HTTP requires url')
    const url = new URL(config.url)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('mcp-client: HTTP requires an HTTP(S) URL')
    return { ...common, transport: 'streamable-http', url: url.href, headers: dictionary(config.headers, 'headers') }
  }
  throw new Error('mcp-client: unsupported transport')
}

/** Selected capabilities and the actual installation or Session resource owner. */
export interface NativeMcpClientPorts {
  /** Consumer-selected diagnostic destination; protocol stdout remains owned by its carrier. */
  readonly logger: McpConnectionPorts['logger']
  readonly tools: NativeToolRegistry
  readonly attachments: AttachmentOperations | undefined
  readonly model: NativeModel | undefined
  readonly scope: NativeScope
  readonly signal: AbortSignal
  readonly effect: ResourceOwner['effect']
}

/** Install one transport under its real Consumer's scope and resource ownership.
 * @param context - explicitly selected native capabilities; no Host or writer is created.
 * @param config - validated transport configuration.
 * @returns completion after initial connection and tool synchronization.
 */
export async function installNativeMcpClient(context: NativeMcpClientPorts, config: Config): Promise<void> {
  const tools = context.tools
  let scopes = namespaces.get(tools)
  if (scopes === undefined) { scopes = new Map(); namespaces.set(tools, scopes) }
  for (const [scope, names] of scopes) {
    if ((scope.contains(context.scope) || context.scope.contains(scope)) && names.has(config.serverName)) {
      throw new Error(`mcp-client: duplicate visible serverName ${config.serverName}`)
    }
  }
  let names = scopes.get(context.scope)
  if (names === undefined) { names = new Set(); scopes.set(context.scope, names) }
  names.add(config.serverName)
  const reservation = names
  context.effect(() => {
    reservation.delete(config.serverName)
    if (reservation.size === 0) scopes.delete(context.scope)
  })
  const connection = startConnection({
    logger: context.logger,
    syncTools: (client, options, previous) => syncTools<NativeToolExecution>(client, {
      logger: context.logger,
      tools: { register: (definition) => {
        context.signal.throwIfAborted()
        const { $schema: dialect, ...parameters } = definition.parameters
        if (dialect !== undefined && dialect !== 'http://json-schema.org/draft-07/schema#'
          && dialect !== 'https://json-schema.org/draft/2020-12/schema') throw new Error('mcp-client: unsupported input schema dialect')
        return tools.registerValueTool({
          schema: { name: definition.name, description: definition.description, parameters },
          output: { schema: definition.output.schema,
            render: (call, value) => ({ content: definition.output.render(call.arguments, value), isError: false }) },
          execute: call => definition.execute(call.arguments, call),
          finalizeResult: (call, _original, selected) => {
            const content = definition.finalizeContent(call, selected)
            return Promise.resolve(content === undefined ? selected : { ...selected, content })
          },
        }, context.scope)
      } },
      resolveImageAdmission: async (call) => {
        const attachments = context.attachments
        if (attachments === undefined) throw new Error('no attachment store is mounted')
        const route = call.session.requestHeader()?.config
        const model = context.model
        if (route === undefined || model?.resolveModel === undefined) throw new Error('the current model route could not be resolved')
        const info = await model.resolveModel(route.provider, route.model, call.signal)
        if (!info.inputModalities?.includes('image')) throw new Error(`model "${route.model}" does not declare image input`)
        call.signal.throwIfAborted()
        return attachments
      },
    }, options, previous),
  }, config, resolveReconnectPolicy(config.reconnect, 'mcp-client: reconnect'))
  context.effect(() => connection.dispose())
  const outcome = await connection.ready
  if (outcome.error !== undefined && config.failOnStartupError) {
    throw new Error(`mcp-client(${config.serverName}): initial connection or tool synchronization failed`, { cause: outcome.error })
  }
}

/** Selected native MCP transport installer; no model loop or Session writer is created. */
export const plugin: NativePlugin = { apiVersion: 1, name: '@deepseek-ai/dsh-mcp-client', targets: ['host'],
  requires: ['tools'], optional: ['attachments', 'model'], provides: [],
  resolve(input) {
    const config = resolveNativeMcpConfig(input)
    return (context: NativeContext) => installNativeMcpClient({ logger: console, tools: context.require('tools'),
      attachments: context.optional('attachments'), model: context.optional('model'), scope: context.scope,
      signal: context.signal, effect: dispose => context.effect(dispose) }, config)
  },
}
export default plugin
