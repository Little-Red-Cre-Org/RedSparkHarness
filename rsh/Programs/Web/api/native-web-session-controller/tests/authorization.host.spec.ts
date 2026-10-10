import { expect, it, vi } from 'vitest'
import { credentialKey, type NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import { NativeAuthorizationProvider } from '@deepseek-ai/dsh-authorization/native'
import { NativeHost, NativeScope, RuntimeEvents, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection/native-host'
import { plugin as agents } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as execution } from '@deepseek-ai/dsh-native-session-execution/native'
import { plugin as modelExecution } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as storage } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { plugin as sandboxPolicy } from '../../../../../Modules/Official/sandbox/native-sandbox-policy/src/native.ts'
import { plugin as sandboxedFilesystem } from '../../../../../Modules/Official/fs/fs-sandbox/src/native.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NativeWebAuthorization } from '../src/authorization.ts'
import { plugin } from '../src/native.ts'

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
  const host = new NativeWebAuthorization({ authorization, credentials }, [key], new AbortController().signal)

  try {
    const begin = await host.handle('authorization/begin', { key, method: 'oauth' })
    expect(begin.ok).toBe(true)
    if (!begin.ok) throw new Error(begin.error.message)
    const { attemptId } = begin.value as { attemptId: string }
    const list = await host.handle('authorization/list', {})
    expect(list.ok).toBe(true)
    if (!list.ok) throw new Error(list.error.message)
    expect(list.value).toEqual([{
      key, label: 'Codex', methods: [{ id: 'oauth', label: 'OAuth' }], configured: false, writable: true, attemptId,
    }])
    expect(await host.handle('authorization/begin', { key: otherKey })).toMatchObject({ ok: false, error: { code: 'native/authorization' } })
    expect(await host.handle('authorization/answer', { key, attemptId: 'wrong', promptId: 'prompt', value: 'x' }))
      .toMatchObject({ ok: false, error: { code: 'native/authorization' } })

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

    const cancel = await host.handle('authorization/cancel', { key, attemptId })
    expect(cancel.ok && cancel.value).toEqual({ cancelled: true })
    expect(authorization.current(key)).toBeUndefined()
  } finally { await authorization.dispose() }
})

it('starts the controller in a profile that installs authorization and credentials', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'rsh-web-authorization-'))
  const scope = new NativeScope()
  const services: NativePlugin = {
    apiVersion: 1, name: 'authorization-fixture', targets: ['host'], requires: [],
    provides: ['model', 'hostConnection', 'credentials', 'authorization'],
    resolve: () => (context) => {
      context.provide('model', { async *stream() {} })
      context.provide('hostConnection', {
        rpc: { handle: () => () => Promise.resolve(), intercept: () => () => Promise.resolve() },
        fetch: { register: () => () => Promise.resolve() },
      } as unknown as HostConnectionHandle)
      context.provide('credentials', {} as NativeCredentials)
      context.provide('authorization', new NativeAuthorizationProvider(scope, {} as NativeCredentials, { events: new RuntimeEvents() }))
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: services, scope, config: undefined },
    { plugin: agents, scope, config: undefined },
    { plugin: execution, scope, config: undefined },
    { plugin: modelExecution, scope, config: undefined },
    { plugin: sandboxPolicy, scope, config: { mode: 'danger-full-access', workspaceRoot: cwd } },
    { plugin: sandboxedFilesystem, scope, config: { cwd } },
    { plugin: storage, scope, config: { root: join(cwd, 'sessions'), compression: 'none' } },
    { plugin, scope, config: { cwd, provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.', maxSteps: 1, builtinTools: false,
      maxPendingRequests: 1, maxHistoryEvents: 10, maxPromptChars: 10,
      maxFollowBufferBytes: 1000, maxFollowers: 1, maxPendingHumanRequests: 1,
      authorizationKeys: ['llm-pi-ai/openai-codex'] } },
  ], 'host'))
  try {
    await host.start()
    expect(host.diagnostics().find(entry => entry.name === plugin.name)?.state).toBe('ready')
  } finally {
    await host.stop()
    await rm(cwd, { recursive: true, force: true })
  }
})
