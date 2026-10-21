/** Cordis tool registration over the shared MCP protocol and image projection. */
import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { syncTools as syncSharedTools, type ToolBridgeOptions, type ToolDisposers } from './tool-core.ts'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
export { publicToolName } from './tool-core.ts'
export type { ToolBridgeOptions, ToolDisposers } from './tool-core.ts'
export type { McpResult } from './types.ts'

/**
 * Replace Cordis tool registrations with the connected server's current tools.
 * @param client - connected protocol client.
 * @param ctx - legacy tool authority.
 * @param opts - resolved bridge options.
 * @param previous - former registrations.
 * @returns accepted registrations after discovery and replacement.
 */
export function syncTools(client: Client, ctx: Context, opts: ToolBridgeOptions, previous: ToolDisposers): Promise<ToolDisposers> {
  return syncSharedTools<ToolExecution>(client, {
    tools: { register: definition => ctx.tools.register(definition) },
    logger: ctx.logger,
    resolveImageAdmission: exec => resolveImageAdmission(ctx, exec),
  }, opts, previous)
}

/**
 * Resolve the active model route and durable store for an image-bearing result.
 * @param ctx - plugin context with optional services.
 * @param exec - exact tool execution whose agent supplies the latest route.
 * @returns the attachment store after exact positive image-capability proof.
 */
async function resolveImageAdmission(ctx: Context, exec: ToolExecution): Promise<AttachmentStore> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) throw new Error('no attachment store is mounted')
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error('the current model route could not be resolved')
  }
  let info: Awaited<ReturnType<typeof llm.resolveModelInfo>>
  try {
    info = await llm.resolveModelInfo(provider, model, exec.signal)
  } catch {
    throw new Error('the current model route could not be verified')
  }
  if (info.inputModalities === undefined || !info.inputModalities.includes('image')) {
    throw new Error(`model "${model}" does not declare image input`)
  }
  if (exec.signal.aborted) throw new Error('the tool call was canceled before image storage')
  return attachments
}
