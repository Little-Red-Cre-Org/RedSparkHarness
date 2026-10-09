import { expect, it, vi } from 'vitest'
import { credentialKey, type NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import { NativeAuthorizationProvider } from '@deepseek-ai/dsh-authorization/native'
import { NativeScope, RuntimeEvents } from '@deepseek-ai/dsh-native-runtime'
import { NativeWebAuthorization } from '../src/authorization.ts'

it('allows only configured keys and keeps a disconnected authorization attempt running', async () => {
  const key = credentialKey('llm-pi-ai', 'openai-codex')
  const otherKey = credentialKey('llm-pi-ai', 'anthropic')
  const credentials = { describeRecord: vi.fn(async () => ({ configured: false, writable: true })) } as unknown as NativeCredentials
  const authorization = new NativeAuthorizationProvider(new NativeScope(), credentials, { events: new RuntimeEvents() })
  authorization.registerFlow({
    key, label: 'Codex', methods: [{ id: 'oauth', label: 'OAuth' }],
    async run(session) { await session.prompt({ kind: 'text', message: 'Enter code' }) },
  })
  authorization.registerFlow({
    key: otherKey, label: 'Other', methods: [{ id: 'oauth', label: 'OAuth' }],
    async run() {},
  })
  const host = new NativeWebAuthorization(authorization, credentials, [key])

  try {
    const { attemptId } = await host.handle('authorization/begin', { key, method: 'oauth' }) as { attemptId: string }
    expect(await host.handle('authorization/list', {})).toEqual([{
      key, label: 'Codex', methods: [{ id: 'oauth', label: 'OAuth' }], configured: false, writable: true, attemptId,
    }])
    await expect(host.handle('authorization/begin', { key: otherKey })).rejects.toThrow()
    await expect(host.handle('authorization/answer', { key, attemptId: 'wrong', promptId: 'prompt', value: 'x' })).rejects.toThrow()

    const wrongAttempt = await host.frames(new Request('http://localhost/api/native-session/authorization', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, attemptId: 'wrong' }),
    }))
    expect(wrongAttempt.status).toBe(409)

    const controller = new AbortController()
    const response = await host.frames(new Request('http://localhost/api/native-session/authorization', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, attemptId }), signal: controller.signal,
    }))
    const reader = response.body?.getReader()
    expect(reader).toBeDefined()
    expect((await reader?.read())?.done).toBe(false)
    controller.abort()
    expect((await reader?.read())?.done).toBe(true)
    expect(authorization.current(key)?.id).toBe(attemptId)

    await expect(host.handle('authorization/cancel', { key, attemptId })).resolves.toEqual({ cancelled: true })
    expect(authorization.current(key)).toBeUndefined()
  } finally { await authorization.dispose() }
})
