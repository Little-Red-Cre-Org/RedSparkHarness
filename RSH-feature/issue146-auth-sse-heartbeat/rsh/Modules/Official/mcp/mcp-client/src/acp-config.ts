/** Standard ACP declarations translated into explicit MCP transport configuration. */

import { createHash } from 'node:crypto'
import { validateHeaderName, validateHeaderValue } from 'node:http'
import { isAbsolute } from 'node:path'
import type { McpServer } from '@agentclientprotocol/sdk'
import type { Config, StdioConfig, StreamableHttpConfig } from './types.ts'

/** ACP transport fields before the owning Program's timeout resolution. */
export type AcpMcpConfig = Omit<StdioConfig, 'toolCallTimeoutMs'> | Omit<StreamableHttpConfig, 'toolCallTimeoutMs'>

const VALID_SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

/** Caller-correctable MCP declaration failure. */
export class AcpMcpConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AcpMcpConfigError'
  }
}

/** Convert one complete server list before any connection is installed.
 * @param servers - parsed standard ACP stdio/HTTP declarations.
 * @param sessionCwd - canonical primary workspace for spawned servers.
 * @param parse - owning Program configuration parser and explicit timeout resolution.
 * @returns validated transport configurations; unsupported transports reject the whole list.
 */
export function resolveAcpMcpConfigs(servers: readonly McpServer[], sessionCwd: string, parse: (input: AcpMcpConfig) => Config): Config[] {
  const names = new Set<string>()
  return servers.map((server, index) => {
    const serverName = normalizeServerName(server.name)
    if (names.has(serverName)) {
      throw new AcpMcpConfigError(`mcpServers contains duplicate normalized name: ${serverName}`)
    }
    names.add(serverName)
    if (!('type' in server)) {
      if (!isAbsolute(server.command)) {
        throw new AcpMcpConfigError(`mcpServers[${index}].command must be an absolute path`)
      }
      const env = entriesToRecord(server.env, `mcpServers[${index}].env`, 'environment')
      const config = validateClientConfig(index, () => parse({
        transport: 'stdio',
        serverName,
        command: server.command,
        args: server.args,
        env,
        cwd: sessionCwd,
        failOnStartupError: true,
      }))
      return { ...config, env }
    }
    if (server.type === 'http') {
      assertHttpUrl(server.url, `mcpServers[${index}].url`)
      const headers = entriesToRecord(server.headers, `mcpServers[${index}].headers`, 'header')
      const config = validateClientConfig(index, () => parse({
        transport: 'streamable-http',
        serverName,
        url: server.url,
        headers,
        failOnStartupError: true,
      }))
      return { ...config, headers }
    }
    throw new AcpMcpConfigError(`mcpServers[${index}] transport ${server.type} is not supported`)
  })
}

/** Convert ordered ACP name/value entries without silently accepting duplicate keys. */
function entriesToRecord(
  entries: readonly { name: string; value: string }[],
  field: string,
  kind: 'environment' | 'header',
): Record<string, string> {
  // Valid environment and header names include "__proto__"; a null prototype
  // keeps that entry as data instead of invoking Object.prototype's setter.
  const result = Object.create(null) as Record<string, string>
  const names = new Set<string>()
  for (const entry of entries) {
    if (kind === 'header') {
      try {
        validateHeaderName(entry.name)
        validateHeaderValue(entry.name, entry.value)
      } catch (_invalidHeader) {
        throw new AcpMcpConfigError(`${field} contains an invalid header entry`)
      }
    } else if (
      entry.name.length === 0
      || entry.name.includes('=')
      || entry.name.includes('\0')
      || entry.value.includes('\0')
    ) {
      throw new AcpMcpConfigError(`${field} contains an invalid environment entry`)
    }
    const identity = kind === 'header' ? entry.name.toLowerCase() : entry.name
    if (names.has(identity)) throw new AcpMcpConfigError(`${field} contains duplicate name: ${entry.name}`)
    names.add(identity)
    result[entry.name] = entry.value
  }
  return result
}

/** Produce a stable DSH tool namespace from ACP's human-readable server name. */
function normalizeServerName(name: string): string {
  if (name.trim().length === 0 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new AcpMcpConfigError('mcpServers contains an invalid server name')
  }
  if (VALID_SERVER_NAME.test(name)) return name
  const slug = name.normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20) || 'server'
  const digest = createHash('sha256').update(name).digest('hex').slice(0, 8)
  return `${slug}_${digest}`.slice(0, 32)
}

/** Require the stable Streamable HTTP transport URL schemes. */
function assertHttpUrl(value: string, field: string): void {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol')
  } catch (_invalidUrl) {
    throw new AcpMcpConfigError(`${field} must be an absolute HTTP(S) URL`)
  }
}

/** Map the existing MCP provider's schema error into ACP invalid params. */
function validateClientConfig(index: number, parse: () => Config): Config {
  try {
    return parse()
  } catch (error: unknown) {
    /* v8 ignore next -- MCP transport validation rejects with Error instances. */
    const detail = error instanceof Error ? error.message : String(error)
    throw new AcpMcpConfigError(`mcpServers[${index}] is invalid: ${detail}`)
  }
}
