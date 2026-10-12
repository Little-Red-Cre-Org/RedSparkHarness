import { expect, it } from 'vitest'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/native'
import { createNativeWorkspaceClients } from '../src/workspaces.ts'

it('closes while a workspace follow iterator is parked at a yielded frame', async () => {
  const rpc: ClientConnectionRpc = {
    call: async () => ({ ok: true, value: undefined }),
    response: async () => new Response('data: {"type":"baseline","value":{"workspaces":[],"archivedSessionIds":[]}}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    }),
  }
  const client = createNativeWorkspaceClients(rpc, 1000)
  const iterator = client.workspace.follow(new AbortController().signal)[Symbol.asyncIterator]()
  let close: Promise<void> | undefined
  try {
    expect((await iterator.next()).value).toMatchObject({ type: 'baseline' })
    close = client.workspace.close()
    const result = await Promise.race([
      close.then(() => 'closed' as const),
      new Promise<'pending'>((resolve) => {
        setTimeout(() => { resolve('pending') }, 100)
      }),
    ])
    expect(result).toBe('closed')
  } finally {
    await iterator.return?.()
    if (close !== undefined) await close
    else await client.workspace.close()
  }
})
