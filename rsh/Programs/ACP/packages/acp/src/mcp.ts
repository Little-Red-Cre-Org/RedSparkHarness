/** Standard ACP MCP declarations mounted through the existing Cordis installer. */
import type { Context } from '@deepseek-ai/cordis'
import type { McpServer } from '@agentclientprotocol/sdk'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { resolveAcpMcpConfigs } from '@deepseek-ai/dsh-mcp-client/acp-config'
export { AcpMcpConfigError } from '@deepseek-ai/dsh-mcp-client/acp-config'

/**
 * Validate and mount one Session's complete standard MCP server list before Agent publication.
 * @param agentCtx - unpublished Agent scope that owns the MCP clients and tools.
 * @param servers - stable ACP stdio or HTTP server declarations.
 * @param sessionCwd - canonical primary workspace used by stdio servers.
 */
export async function mountAcpMcpServers(agentCtx: Context, servers: readonly McpServer[], sessionCwd: string): Promise<void> {
  const configs = resolveAcpMcpConfigs(servers, sessionCwd, input => McpClient.Config(input))
  for (const config of configs) await agentCtx.plugin(McpClient, config)
}
