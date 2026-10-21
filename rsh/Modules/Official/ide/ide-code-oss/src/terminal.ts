/** Native-owned MCP endpoint for the live Code OSS task executor. */
import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { WebSocketServer, type WebSocket } from 'ws'
import { z } from 'zod'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'

/** Separate credentials for model-tool callers and the shell-owned executor. */
export interface IdeTerminalBridge {
  /** Loopback MCP URL without credentials. */
  readonly url: string
  /** Bearer credential for the existing MCP client. */
  readonly token: string
  /** Private executor address; contains a different credential. */
  readonly executorUrl: string
  /** Close admission, reject pending requests and drain network resources. */
  close(): Promise<void>
}

/**
 * Start one authenticated loopback bridge owned by a Native installation.
 * @returns private MCP and executor addresses; callers must not log credentials.
 */
export async function startIdeTerminalBridge(): Promise<IdeTerminalBridge> {
  const token = randomBytes(32).toString('hex')
  const executorKey = randomBytes(32).toString('hex')
  let executor: WebSocket | undefined
  let closing = false
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const connections = new Set<McpServer>()
  const transports = new Map<string, StreamableHTTPServerTransport>()
  const websocket = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
  const disconnect = (): void => {
    for (const request of pending.values()) request.reject(new Error('IDE executor disconnected; execution outcome is unknown.'))
    pending.clear()
  }
  const server = createServer((request, response) => {
    if (closing || request.headers.origin !== undefined || request.headers.authorization !== `Bearer ${token}` || request.url !== '/mcp') {
      response.writeHead(403).end(); return
    }
    const sessionId = request.headers['mcp-session-id']
    if (sessionId !== undefined) {
      const transport = typeof sessionId === 'string' ? transports.get(sessionId) : undefined
      if (transport === undefined) { response.writeHead(404).end(); return }
      void transport.handleRequest(request, response).catch(() => { response.destroy() })
      return
    }
    if (request.method !== 'POST') { response.writeHead(400).end(); return }
    const mcp = new McpServer({ name: 'rsh-ide', version: '1.0.0' })
    connections.add(mcp)
    mcp.registerTool('ide_run', {
      description: 'Run the current Python, Java, C or C++ editor file (compiled languages build before execution) or a named project task in the visible RSH IDE terminal. The user confirms the actual file and workspace in the IDE. Use status for recorded exit codes and stop to request termination. Output is visible in the IDE terminal, not returned here; never invent output or claim success from a running status. Requires the IDE to be open. Background shell tools do not use this terminal.',
      inputSchema: {
        action: z.enum(['file', 'task', 'status', 'stop']),
        workspace: z.string().min(1).describe('Absolute workspace directory for this conversation; must match an open IDE folder.'),
        task: z.string().optional().describe('Exact configured project task name; required for action task.'),
        runId: z.string().optional().describe('Run identifier returned by this tool; required for stop.'),
      },
    }, async (args, extra) => {
      if (executor?.readyState !== 1) return { isError: true, content: [{ type: 'text', text: 'IDE is not connected. Open the RSH IDE before running code.' }] }
      if ((args.action === 'task' && args.task === undefined) || (args.action === 'stop' && args.runId === undefined)) {
        return { isError: true, content: [{ type: 'text', text: 'task requires a task name; stop requires a runId.' }] }
      }
      const id = randomUUID()
      const result = Promise.withResolvers<unknown>()
      const abort = (): void => {
        if (executor?.readyState === 1) executor.send(JSON.stringify({ id, action: 'cancel' }))
        pending.delete(id); result.reject(new Error('IDE request cancelled; inspect terminal status before retrying.'))
      }
      extra.signal.addEventListener('abort', abort, { once: true })
      pending.set(id, result)
      try {
        extra.signal.throwIfAborted()
        executor.send(JSON.stringify({ id, ...args }))
        return { content: [{ type: 'text' as const, text: JSON.stringify(await result.promise) }] }
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: String(error) }] }
      } finally { pending.delete(id); extra.signal.removeEventListener('abort', abort) }
    })
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true, sessionIdGenerator: randomUUID,
      onsessioninitialized: (id) => { transports.set(id, transport) },
    })
    mcp.server.onclose = () => {
      connections.delete(mcp)
      if (transport.sessionId !== undefined) transports.delete(transport.sessionId)
    }
    void mcp.connect(transport as Transport).then(() => transport.handleRequest(request, response)).catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500).end(String(error))
      else response.destroy()
    }).finally(async () => { if (transport.sessionId === undefined) await mcp.close() })
  })
  server.on('upgrade', (request, socket, head) => {
    if (closing || request.headers.origin !== undefined || request.url !== `/executor/${executorKey}` || executor !== undefined) {
      socket.destroy(); return
    }
    websocket.handleUpgrade(request, socket, head, (connection) => {
      executor = connection
      connection.on('error', () => { connection.terminate() })
      connection.once('close', () => { executor = undefined; disconnect() })
      connection.on('message', (data) => {
        let value: unknown
        try { value = JSON.parse(data.toString()) } catch { connection.close(1003); return }
        if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string') { connection.close(1003); return }
        const request = pending.get(value.id)
        if (request === undefined) return
        pending.delete(value.id)
        if ('error' in value && typeof value.error === 'string') request.reject(new Error(value.error))
        else if ('result' in value) request.resolve(value.result)
        else request.reject(new Error('IDE returned no execution result'))
      })
    })
  })
  const plugin: NativePlugin = {
    apiVersion: 1, name: 'rsh-ide-terminal', targets: ['host'], requires: [], provides: [],
    resolve: () => async (context) => {
      context.own(async () => {
        closing = true
        disconnect()
        executor?.terminate()
        await Promise.all([...connections].map(connection => connection.close()))
        await new Promise<void>(resolve => websocket.close(() => { resolve() }))
        server.closeAllConnections()
        await new Promise<void>((resolve, reject) => server.close((error) => { if (error !== undefined) reject(error); else resolve() }))
      })
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
      })
    },
  }
  const host = new NativeHost(resolveInstallation([{ plugin, scope: new NativeScope(), config: undefined }], 'host'))
  await host.start()
  const address = server.address()
  if (address === null || typeof address === 'string') { await host.stop(); throw new Error('IDE terminal did not bind a TCP port') }
  return { url: `http://127.0.0.1:${address.port}/mcp`, token,
    executorUrl: `ws://127.0.0.1:${address.port}/executor/${executorKey}`, close: () => host.stop() }
}
