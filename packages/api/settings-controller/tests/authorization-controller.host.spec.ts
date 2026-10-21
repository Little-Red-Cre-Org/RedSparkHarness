import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import AuthorizationController from '../src/authorization.ts'
import type { AuthorizationFrame } from '../src/types.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'

const KEY = credentialKey('llm-pi-ai', 'openai-codex')

async function boot(): Promise<{ ctx: Context; controller: AuthorizationController }> {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(AuthorizationController, { keys: [KEY] })
  return { ctx, controller: ctx.authorizationController }
}

describe('the authorization Remote namespace a configuration surface calls', () => {
  it('releases the running flow when the stream consumer returns early', async () => {
    const { ctx, controller } = await boot()
    let observedSignal: AbortSignal | undefined
    ctx.authorization.registerFlow({
      key: KEY, label: 'OpenAI Codex', methods: [{ id: 'oauth', label: 'Login' }],
      async run(session) {
        observedSignal = session.signal
        await session.prompt({ kind: 'text', message: 'Code' })
      },
    })
    const stream = controller.authorize(KEY, 'oauth', new AbortController().signal)[Symbol.asyncIterator]()
    await stream.next()
    await stream.return?.()
    expect(observedSignal?.aborted).toBe(true)
    expect(ctx.authorization.describe(KEY)?.inFlight).toBe(false)
  })

  it('rejects an already withdrawn prompt without publishing it', async () => {
    const { ctx, controller } = await boot()
    ctx.authorization.registerFlow({
      key: KEY, label: 'OpenAI Codex', methods: [{ id: 'oauth', label: 'Login' }],
      async run(session) {
        await session.prompt({ kind: 'text', message: 'Code', signal: AbortSignal.abort() })
      },
    })
    const stream = controller.authorize(KEY, 'oauth', new AbortController().signal)[Symbol.asyncIterator]()
    expect((await stream.next()).value).toMatchObject({ type: 'started' })
    await expect(stream.next()).rejects.toMatchObject({ code: 'authorization/rejected' })
    expect(ctx.authorization.describe(KEY)?.inFlight).toBe(false)
  })

  it('hides other registered providers and rejects their start requests', async () => {
    const { ctx, controller } = await boot()
    const otherKey = credentialKey('llm-pi-ai', 'other-provider')
    const run = vi.fn(async () => {})
    ctx.authorization.registerFlow({ key: otherKey, label: 'Other provider', methods: [{ id: 'oauth', label: 'Login' }], run })
    expect(await controller.list()).toEqual([])
    const stream = controller.authorize(otherKey, undefined, new AbortController().signal)[Symbol.asyncIterator]()
    await expect(stream.next()).rejects.toMatchObject({ code: 'authorization/rejected' })
    expect(run).not.toHaveBeenCalled()
  })

  it('exposes no account flows without an explicit deployment selection', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryCredentials)
    await ctx.plugin(AuthorizationService)
    await ctx.plugin(AuthorizationController)
    ctx.authorization.registerFlow({ key: KEY, label: 'OpenAI Codex', methods: [{ id: 'oauth', label: 'Login' }], async run() {} })
    expect(await ctx.authorizationController.list()).toEqual([])
  })

  it('registers before optional providers and reports their absence at invocation', async () => {
    const ctx = new Context()
    await ctx.plugin(AuthorizationController)

    await expect(ctx.authorizationController.list()).rejects.toMatchObject({ code: 'gateway/internal' })
  })

  it('publishes one streamed conversation and two attempt-scoped prompt controls', async () => {
    const { controller } = await boot()
    expect(controller.typertRemote).toMatchObject({
      serviceKey: 'authorizationController',
      namespace: 'authorization',
    })
    expect(remoteMethods(controller)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'authorize', mode: 'stream', invocation: { kind: 'direct' } },
      { method: 'answer', invocation: { kind: 'direct' } },
      { method: 'decline', invocation: { kind: 'direct' } },
    ])
  })

  it('redacts arbitrary provider failures while retaining allowlisted authorization codes', async () => {
    const { ctx, controller } = await boot()
    ctx.authorization.registerFlow({
      key: KEY, label: 'OpenAI Codex', methods: [{ id: 'oauth', label: 'Login' }],
      async run() {
        throw new Error('token response https://callback.example/?code=secret-code access_token=secret-token')
      },
    })
    const iterator = controller.authorize(KEY, 'oauth', new AbortController().signal)[Symbol.asyncIterator]()
    await iterator.next()
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'authorization/rejected',
      message: 'account sign-in failed; try again',
      details: {},
    })
  })

  it('streams notices and prompts, accepts the answer, and reports the committed record', async () => {
    const { ctx, controller } = await boot()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'ChatGPT (Codex)',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      async run(session) {
        session.notify({ message: 'Open the page', url: 'https://auth.example/' })
        const code = await session.prompt({ kind: 'text', message: 'Paste the code' })
        await ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'grant', payload: { code } }))
      },
    })

    expect(await controller.list()).toEqual([{
      key: KEY,
      label: 'ChatGPT (Codex)',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      inFlight: false,
      configured: false,
      writable: true,
    }])

    const iterator = controller.authorize(KEY, 'oauth', new AbortController().signal)[Symbol.asyncIterator]()
    const started = await iterator.next()
    expect(started.value).toMatchObject({ type: 'started' })
    expect((await iterator.next()).value).toEqual({
      type: 'notice',
      notice: { message: 'Open the page', url: 'https://auth.example/' },
    })
    const prompted = (await iterator.next()).value as AuthorizationFrame | undefined
    expect(prompted).toMatchObject({ type: 'prompt', prompt: { kind: 'text', message: 'Paste the code' } })
    if (prompted?.type !== 'prompt') throw new Error('fixture expected an authorization prompt')
    controller.answer(prompted.attemptId, prompted.promptId, 'code-123')
    expect((await iterator.next()).value).toEqual({ type: 'settled', status: 'authorized' })
    expect((await iterator.next()).done).toBe(true)
    expect(await controller.list()).toMatchObject([{ configured: true, kind: 'grant', inFlight: false }])
  })

  it('turns a declined browser prompt into a cancelled outcome', async () => {
    const { ctx, controller } = await boot()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'ChatGPT (Codex)',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      async run(session) {
        await session.prompt({ kind: 'select', message: 'Choose', options: [{ id: 'one', label: 'One' }] })
      },
    })
    const iterator = controller.authorize(KEY, 'oauth', new AbortController().signal)[Symbol.asyncIterator]()
    await iterator.next()
    const prompted = (await iterator.next()).value as AuthorizationFrame | undefined
    if (prompted?.type !== 'prompt') throw new Error('fixture expected an authorization prompt')
    controller.decline(prompted.attemptId, prompted.promptId)
    expect((await iterator.next()).value).toEqual({ type: 'settled', status: 'cancelled' })
  })
})
