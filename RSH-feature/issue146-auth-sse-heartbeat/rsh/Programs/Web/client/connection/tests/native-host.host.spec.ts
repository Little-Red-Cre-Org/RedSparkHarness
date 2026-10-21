/** Native Host Connection registry keeps carrier mounting and authentication framework-free. */

import { describe, expect, it } from 'vitest'
import type { CredentialRecord, NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import { createNativeHostConnectionRegistry, resolveNativeHostConnectionConfig } from '../src/native-host.ts'

function credentials(): Pick<NativeCredentials, 'modifyRecord'> {
  let value: CredentialRecord | undefined
  return {
    async modifyRecord(_key, mutate) {
      value = await mutate(value)
      return value
    },
  }
}

describe('native Host Connection registry', () => {
  it('validates trust and cookie configuration before activation', () => {
    expect(resolveNativeHostConnectionConfig()).toEqual({ trustedHosts: [], cookieMaxAgeDays: 30 })
    expect(() => resolveNativeHostConnectionConfig({ trustedHosts: ['example.test/path'] }))
      .toThrow('trustedHosts entry')
    expect(() => resolveNativeHostConnectionConfig({ cookieMaxAgeDays: 0 }))
      .toThrow('cookieMaxAgeDays must be a positive integer')
    expect(() => resolveNativeHostConnectionConfig({ extra: true }))
      .toThrow('unknown configuration field extra')
  })

  it('mounts one RPC channel through the carrier and keeps the shared auth fence', async () => {
    const mounted: Array<{ channel: string; handler: { fetch(request: Request): Promise<Response> } }> = []
    const owner = {
      effect(setup: () => (() => void | Promise<void>)): () => Promise<void> {
        const dispose = setup()
        return async () => { await dispose() }
      },
      mount(channel: string, handler: { fetch(request: Request): Promise<Response> }): () => void {
        const row = { channel, handler }
        mounted.push(row)
        return () => { mounted.splice(mounted.indexOf(row), 1) }
      },
    }
    const registry = await createNativeHostConnectionRegistry({}, credentials())
    const connection = registry.forOwner(owner)
    const dispose = connection.rpc.handle('/native', async (endpoint, payload) => ({
      ok: true, value: { endpoint, payload },
    }))

    expect(mounted).toHaveLength(1)
    expect(mounted[0]?.channel).toBe('/native')
    const response = await mounted[0]!.handler.fetch(new Request('http://dsh.test/native/ping', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'r1', method: 'ping', payload: { ok: true } }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ rpcId: 'r1', result: { ok: true, value: { endpoint: 'ping', payload: { ok: true } } } })
    expect(connection.requestRejection({ headers: { host: 'attacker.test' } })).toBe(403)
    expect(connection.requestRejection({ headers: { host: '127.0.0.1:4321' } })).toBe(401)
    await dispose()
    expect(mounted).toHaveLength(0)
  })
})
