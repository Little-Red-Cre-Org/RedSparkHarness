/** Real Native owner, HTTP MCP client and authenticated executor transport, without a model. */
import { once } from 'node:events'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { WebSocket } from 'ws'
import { expect, it } from 'vitest'
import { startIdeTerminalBridge } from '../src/terminal.ts'

it.each([true, false])('IDE MCP execution with connected executor=%s', async (connected) => {
  const bridge = await startIdeTerminalBridge()
  const client = new Client({ name: 'ide-terminal-test', version: '1.0.0' })
  const started = Promise.withResolvers<undefined>()
  const cancelled = Promise.withResolvers<undefined>()
  let socket: WebSocket | undefined
  try {
    expect((await fetch(bridge.url)).status).toBe(403)
    expect((await fetch(bridge.url, { headers: { Authorization: `Bearer ${bridge.token}`, Origin: 'https://example.com' } })).status).toBe(403)
    if (connected) {
      socket = new WebSocket(bridge.executorUrl)
      await once(socket, 'open')
      socket.on('message', (bytes) => {
        const request = JSON.parse(bytes.toString()) as { id: string; action: string; workspace: string; task?: string }
        if (request.action === 'cancel') { cancelled.resolve(undefined); return }
        expect(request.workspace).toBe('C:/project')
        if (request.task === 'pending') { started.resolve(undefined); return }
        socket!.send(JSON.stringify({ id: request.id, result: { id: 'run-1', state: 'running', file: 'hello.py' } }))
      })
    }
    await client.connect(new StreamableHTTPClientTransport(new URL(bridge.url), {
      requestInit: { headers: { Authorization: `Bearer ${bridge.token}` } },
    }) as Transport)
    const tools = await client.listTools()
    expect(tools.tools.map(tool => tool.name)).toEqual(['ide_run'])
    const result = await client.callTool({ name: 'ide_run', arguments: { action: 'file', workspace: 'C:/project' } })
    expect({ tools: tools.tools, result }).toMatchSnapshot()
    if (connected) {
      expect(result.isError).not.toBe(true)
      const controller = new AbortController()
      const waiting = client.callTool({ name: 'ide_run', arguments: { action: 'task', task: 'pending', workspace: 'C:/project' } },
        undefined, { signal: controller.signal }).catch(() => 'cancelled')
      await started.promise
      controller.abort()
      expect(await waiting).toBe('cancelled')
      await cancelled.promise
    }
    else expect(result.isError).toBe(true)
  } finally {
    socket?.terminate()
    await client.close()
    await bridge.close()
  }
})
