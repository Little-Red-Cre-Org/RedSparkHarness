/** Session grants travel through the real authenticated Web carrier and sole Session writer. */
import { mkdtemp, mkdir, realpath, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as agents } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as execution } from '@deepseek-ai/dsh-native-session-execution/native'
import { plugin as modelExecution } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as tools } from '@deepseek-ai/dsh-native-tools/native'
import { plugin as approval } from '@deepseek-ai/dsh-native-approval/native'
import { plugin as filesystem } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as fsPolicy } from '@deepseek-ai/dsh-fs-observation-policy/native'
import { plugin as fileTools } from '@deepseek-ai/dsh-tool-fs/native'
import { plugin as storage } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { plugin as workspaceRegistry } from '@deepseek-ai/dsh-workspace/native'
import { plugin as storageHub } from '@deepseek-ai/dsh-storage/native'
import { plugin as storageJson } from '@deepseek-ai/dsh-storage-json/native'
import { plugin as storageDomain } from '@deepseek-ai/dsh-storage-domain/native'
import { createNativeHostConnectionRegistry } from '@deepseek-ai/dsh-client-connection/native-host'
import { createWebConnectionRpc } from '@deepseek-ai/dsh-client-connection/native'
import { bridge } from '@deepseek-ai/dsh-client-connection/native-http-bridge'
import { listenNativeHttpHost, type NativeHttpHost } from '@deepseek-ai/dsh-native-web-assets'
import { createNativeSessionClient } from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeSessionFollowFrame } from '@deepseek-ai/dsh-client-native-session/follow-types'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials/native'
import { createUserMessage, ToolCallId, type StreamChunk, type GenerateOptions } from '@deepseek-ai/dsh-llm/native'
import type { NativeToolRegistry, NativeToolExecution } from '@deepseek-ai/dsh-native-tools'
import type { FileSystemOperations } from '@deepseek-ai/dsh-fs/native'
import type { NativeSessionPersistenceOperations, SessionHandle } from '@deepseek-ai/dsh-session-persistence/native'
import type { NativeRootExecutionOperations, NativeRootRouteId } from '@deepseek-ai/dsh-native-session-execution'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { toolCallResponse, textResponse } from '../../../../../Engine/core/agent-loop/tests/mock-adapter.ts'
import { plugin } from '../src/native.ts'

async function fixture(directory: string, cwd: string) {
  const scope = new NativeScope()
  let web: NativeHttpHost | undefined
  const requests: GenerateOptions[] = []
  const steps: StreamChunk[][] = []
  let roots!: NativeRootExecutionOperations
  let persistence!: NativeSessionPersistenceOperations
  let registry!: NativeToolRegistry
  let fs!: FileSystemOperations
  const capture: NativePlugin = {
    apiVersion: 1, name: 'session-grant-capture', targets: ['host'],
    requires: ['rootExecution', 'sessionPersistence', 'tools', 'fs'], provides: [],
    resolve: () => (context) => {
      roots = context.require('rootExecution')
      persistence = context.require('sessionPersistence')
      registry = context.require('tools')
      fs = context.require('fs')
    },
  }
  const model: NativePlugin = {
    apiVersion: 1, name: 'session-grant-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => {
      context.provide('model', { async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
        requests.push(request)
        const next = steps.shift()
        if (next === undefined) throw new Error('grant fixture script exhausted')
        yield* next
      } })
    },
  }
  const carrier: NativePlugin = {
    apiVersion: 1, name: 'session-grant-carrier', targets: ['host'], requires: [], provides: ['hostConnection', 'httpRoutes'],
    resolve: () => async (context) => {
      let record: CredentialRecord | undefined
      const registry = await createNativeHostConnectionRegistry({}, { async modifyRecord(_key, mutate) {
        record = await mutate(record)
        return record
      } })
      web = await listenNativeHttpHost(registry, { requestBodyMode: () => 'buffered', fetch: () => Promise.resolve(new Response('native')) }, bridge, { port: 0 })
      context.own(() => web!.close())
      context.provide('hostConnection', web.connection)
      context.provide('httpRoutes', web.httpRoutes)
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin, scope, config: { cwd, provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.', maxSteps: 32, builtinTools: false,
      maxPendingRequests: 2, maxHistoryEvents: 1000, maxPromptChars: 100, maxFollowBufferBytes: 1000000,
      maxFollowers: 4, maxPendingHumanRequests: 2 } },
    ...[agents, execution, modelExecution, tools, approval, fsPolicy, fileTools, model, carrier, workspaceRegistry, storageHub, capture]
      .map(plugin => ({ plugin, scope, config: undefined })),
    { plugin: filesystem, scope, config: { cwd } },
    { plugin: storage, scope, config: { root: join(directory, 'sessions'), compression: 'none' } },
    { plugin: storageJson, scope, config: { root: join(directory, 'domains') } },
    { plugin: storageDomain, scope, config: { backend: 'json' } },
  ], 'host'))
  try {
    await host.start()
    if (web === undefined) throw new Error('missing real HTTP Host')
    const url = web.url
    const login = await fetch(web.connection.authenticatedUrl(url), { redirect: 'manual' })
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    if (cookie === undefined) throw new Error('missing local browser authentication')
    const rpc = createWebConnectionRpc((input, init) => {
      const headers = new Headers(init.headers)
      headers.set('cookie', cookie)
      return fetch(new URL(input.pathname, url), { ...init, headers })
    })
    const client = createNativeSessionClient(rpc, { maxFollowBufferChars: 1000000 })
    return { client, roots, persistence, registry, fs, requests, steps, async close() {
      await client.close()
      await host.stop()
    } }
  } catch (error: unknown) {
    await host.stop()
    throw error
  }
}

async function cleanup(directory: string) {
  if (!directory.startsWith(await realpath(tmpdir()))) throw new Error('unexpected grant fixture cleanup target')
  await rm(directory, { recursive: true, force: true })
}

async function run(state: Awaited<ReturnType<typeof fixture>>, id: SessionId, calls: StreamChunk[][],
  expected: 'session' | 'once' | 'reuse', beforeAnswer?: () => Promise<void>) {
  state.steps.push(...calls, textResponse('Settled.'))
  const frames: NativeSessionFollowFrame[] = []
  const presented = Promise.withResolvers<undefined>()
  const turn = state.client.prompt(id, 'Execute.', true, undefined, (frame) => {
    frames.push(frame)
    if (frame.type === 'human') presented.resolve(undefined)
  }).then(value => ({ value }), (error: unknown) => ({ error }))
  if (expected !== 'reuse') {
    await Promise.race([presented.promise, turn])
    const human = frames.find(frame => frame.type === 'human')
    if (human?.type !== 'human' || human.prompt.kind !== 'approval') throw new Error('missing real approval')
    expect(human.prompt.canAllowSession).toBe(expected === 'session' ? true : undefined)
    if (expected === 'once') {
      await expect(state.client.answerHuman(id, human.prompt.id, { kind: 'approval', outcome: 'allowed-session' }))
        .rejects.toThrow('no reusable Session scope')
    }
    await beforeAnswer?.()
    await state.client.answerHuman(id, human.prompt.id, { kind: 'approval', outcome: expected === 'session' ? 'allowed-session' : 'allowed-once' })
  }
  await expect(turn).resolves.toMatchObject({ value: { exitCode: 0, answer: 'Settled.' } })
  expect(frames.filter(frame => frame.type === 'human')).toHaveLength(expected === 'reuse' ? 0 : 1)
  return frames
}

it.each([{ content: 'Approved exact content.' }])('remembers only the complete frozen operation scope ($content)', async ({ content }) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'rsh-web-session-grant-')))
  const cwd = join(directory, 'work')
  await mkdir(cwd)
  const state = await fixture(directory, cwd)
  try {
    const id = (await state.client.create()).sessionId
    await run(state, id, [toolCallResponse('first-write', 'write', { file_path: 'approved.txt', content }),
      toolCallResponse('second-write', 'write', { content, file_path: 'approved.txt' })], 'session')
    expect(await readFile(join(cwd, 'approved.txt'), 'utf8')).toBe(content)
    const initial = (await state.client.history(id)).events.filter(event => event.type === 'native-approval/decided')
    expect(initial).toHaveLength(2)
    expect(initial[0]?.data).toMatchObject({ sessionGrant: { sessionId: id } })
    expect(initial[0]?.data.sessionGrant?.scopeKey).toMatch(/^[a-f0-9]{64}$/u)
    expect(initial[1]?.data.sessionGrant).toBeUndefined()
    await run(state, id, [toolCallResponse('observe-changed-value', 'read', { file_path: 'approved.txt' }),
      toolCallResponse('changed-value', 'write', { file_path: 'approved.txt', content: 'Changed.' })], 'session')
    expect(await readFile(join(cwd, 'approved.txt'), 'utf8')).toBe('Changed.')

    const first = join(cwd, 'first')
    const second = join(cwd, 'second')
    const alias = join(cwd, 'alias')
    await mkdir(first)
    await mkdir(second)
    await writeFile(join(first, 'target.txt'), 'First.')
    await writeFile(join(second, 'target.txt'), 'Second.')
    await symlink(first, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const aliased = () => toolCallResponse(randomUUID(), 'write', { file_path: 'alias/target.txt', content })
    await run(state, id, [toolCallResponse('observe-first', 'read', { file_path: 'alias/target.txt' }), aliased()], 'session')
    await unlink(alias)
    await symlink(second, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await run(state, id, [toolCallResponse('observe-second', 'read', { file_path: 'alias/target.txt' }), aliased()], 'session', async () => {
      await unlink(alias)
      await symlink(first, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await writeFile(join(first, 'target.txt'), 'Unapproved destination.')
    })
    expect(await readFile(join(first, 'target.txt'), 'utf8')).toBe('Unapproved destination.')
    expect(await readFile(join(second, 'target.txt'), 'utf8')).toBe(content)

    let effectiveCwd = first
    let mode: 'ordinary' | 'missing' | 'incomplete' | 'escalation' = 'ordinary'
    let executions = 0
    let admitted: NativeToolExecution | undefined
    const registration = state.registry.register({ schema: { name: 'scoped_probe', description: 'Scope boundary fixture.',
      parameters: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'], additionalProperties: false } },
    async execute(call) {
      admitted = call
      expect(Object.isFrozen(call.arguments)).toBe(true)
      expect(Object.isFrozen((call.arguments as { items: string[] }).items)).toBe(true)
      const root = await state.fs.resolve(effectiveCwd, { signal: call.signal })
      const target = await state.fs.resolve(join(second, 'target.txt'), { signal: call.signal })
      const sessionContext = { cwdKey: mode === 'incomplete' ? '' : root.targetKey, targetKey: target.targetKey }
      if (mode === 'escalation') {
        expect(await call.requestApproval!({ sessionContext }, call.signal)).toBe('allowed-once')
      } else await call.authorize!({ ...mode === 'missing' ? {} : { sessionContext } }, call.signal)
      executions++
      return { content: [{ type: 'text', text: 'Executed.' }], isError: false }
    } })
    try {
      const probe = (items: string[]) => toolCallResponse(randomUUID(), 'scoped_probe', { items })
      await run(state, id, [probe(['a', 'b'])], 'session')
      await run(state, id, [probe(['a', 'b'])], 'reuse')
      await run(state, id, [probe(['b', 'a'])], 'session')
      await run(state, id, [probe(['a', 'c'])], 'session')
      effectiveCwd = second
      await run(state, id, [probe(['a', 'b'])], 'session')
      mode = 'missing'
      await run(state, id, [probe(['a', 'b'])], 'once')
      mode = 'incomplete'
      await run(state, id, [probe(['a', 'b'])], 'once')
      mode = 'escalation'
      await run(state, id, [probe(['a', 'b'])], 'once')
      expect(executions).toBe(8)
      if (admitted === undefined) throw new Error('missing admitted tool invocation')
      mode = 'ordinary'
      let delegatedRequests = 0
      await expect(state.registry.execute({ ...admitted, callId: ToolCallId('delegated-probe'), signal: new AbortController().signal,
        delegationContext: { depth: 1, maxDepth: 2, cwd: second, provider: 'fixture', model: 'fixture',
          maxSteps: 2, toolNames: ['scoped_probe'], builtinToolNames: [], programToolNames: [] },
        approvalAuthority: { async request() { throw new Error('unexpected escalation') }, async authorize(request) {
          delegatedRequests++
          expect(request.sessionGrant).toBeUndefined()
          throw new Error('fixture: delegated request remains one-shot')
        } } })).rejects.toThrow('delegated request remains one-shot')
      expect(delegatedRequests).toBe(1)
      expect(executions).toBe(8)
    } finally { await registration() }
    const raw = (await state.client.history(id)).events
    const scopeKeys: string[] = []
    for (const event of raw) {
      if (event.type === 'tool/result') expect(event.data.error).toBeUndefined()
      if (event.type === 'native-approval/decided' && event.data.sessionGrant !== undefined) {
        expect(event.data.sessionGrant.sessionId).toBe(id)
        expect(event.data.sessionGrant.scopeKey).toMatch(/^[a-f0-9]{64}$/u)
        scopeKeys.push(event.data.sessionGrant.scopeKey)
      }
    }
    expect(scopeKeys).toHaveLength(8)
    expect(new Set(scopeKeys).size).toBe(8)
  } finally {
    await state.close()
    await cleanup(directory)
  }
}, 30000)

it.each([{ content: 'Durable original Session grant.' }])('restores the same Session but isolates copied grants ($content)', async ({ content }) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'rsh-web-grant-restore-')))
  const cwd = join(directory, 'work')
  await mkdir(cwd)
  let state = await fixture(directory, cwd)
  try {
    const id = (await state.client.create()).sessionId
    const write = () => toolCallResponse(randomUUID(), 'write', { file_path: 'approved.txt', content })
    await run(state, id, [write()], 'session')
    const original = (await state.client.history(id)).events.find(event => event.type === 'native-approval/decided')
    if (original?.type !== 'native-approval/decided' || original.data.sessionGrant === undefined) throw new Error('missing original raw grant')
    const originalGrant = original.data.sessionGrant
    await state.close()
    state = await fixture(directory, cwd)
    await run(state, id, [write()], 'reuse')
    const child = SessionId(randomUUID())
    const route = brandString<NativeRootRouteId>('root')
    await state.roots.fork({ route, source: id, id: child }, new AbortController().signal)
    const inherited = (await state.client.history(child)).events.filter(event => event.type === 'native-approval/decided')
    expect(inherited.some(event => event.data.sessionGrant?.sessionId === id)).toBe(true)
    await run(state, child, [write()], 'session')
    const childDecision = (await state.client.history(child)).events.filter(event => event.type === 'native-approval/decided').at(-1)
    expect(childDecision?.data.sessionGrant).toEqual({ sessionId: child, scopeKey: originalGrant.scopeKey })
    const fresh = (await state.client.create()).sessionId
    await run(state, fresh, [write()], 'session')
    const freshDecision = (await state.client.history(fresh)).events.filter(event => event.type === 'native-approval/decided').at(-1)
    expect(freshDecision?.data.sessionGrant).toEqual({ sessionId: fresh, scopeKey: originalGrant.scopeKey })
    expect(await readFile(join(cwd, 'approved.txt'), 'utf8')).toBe(content)
    const signal = new AbortController().signal
    await state.roots.maintenance({ route, id, resume: true }, async (owner) => {
      owner.append('execution/policy', { version: 1, maxSteps: 4,
        permission: { mode: 'require-approval', authority: 'session-owner' } })
      await owner.flush()
    }, signal)
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Write.' }] })
    await expect(state.roots.execute({ route, id, resume: true, message }, signal))
      .rejects.toThrow('live exact-owner approval capability')
    let ownerRequests = 0
    const writes = vi.spyOn(state.fs, 'writeText')
    try {
      state.steps.push(write(), textResponse('Settled.'))
      await state.roots.execute({ route, id, resume: true, message, issueOwnerApproval: owner => ({
        agent: owner.agent, session: owner.session, lifetime: signal, async authorize() {
          ownerRequests++
          return 'rejected'
        },
      }) }, signal)
      expect(ownerRequests).toBe(1)
      expect(writes).not.toHaveBeenCalled()
      await state.roots.maintenance({ route, id: child, resume: true }, async (owner) => {
        owner.append('execution/policy', { version: 1, maxSteps: 4, permission: { mode: 'deny' } })
        await owner.flush()
      }, signal)
      await run(state, child, [write()], 'reuse')
      const decision = (await state.client.history(child)).events.filter(event => event.type === 'native-approval/decided').at(-1)
      expect(decision?.data).toMatchObject({ policy: 'never', outcome: 'rejected' })
      expect(writes).not.toHaveBeenCalled()
      await state.roots.maintenance({ route, id: fresh, resume: true }, async (owner) => {
        owner.append('approval/policy', { policy: 'never' })
        await owner.flush()
      }, signal)
      await run(state, fresh, [write()], 'reuse')
      const override = (await state.client.history(fresh)).events.filter(event => event.type === 'native-approval/decided').at(-1)
      expect(override?.data).toMatchObject({ policy: 'never', outcome: 'rejected' })
      expect(writes).not.toHaveBeenCalled()
    } finally { writes.mockRestore() }
  } finally {
    await state.close()
    await cleanup(directory)
  }
}, 30000)

it.each([{ content: 'Must never execute.' }])('blocks execution when the grant decision durability barrier fails ($content)', async ({ content }) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'rsh-web-grant-flush-')))
  const cwd = join(directory, 'work')
  await mkdir(cwd)
  const state = await fixture(directory, cwd)
  const restores: (() => void)[] = []
  let failed = false
  const intercept = (handle: SessionHandle) => {
    if (handle.access !== 'write') return handle
    let grantPending = false
    const append = handle.append.bind(handle)
    const appendSpy = vi.spyOn(handle, 'append').mockImplementation(async (events, options) => {
      await append(events, options)
      if (events.some(event => event.type === 'native-approval/decided' && event.data.sessionGrant !== undefined)) grantPending = true
    })
    const flush = handle.flush.bind(handle)
    const flushSpy = vi.spyOn(handle, 'flush').mockImplementation(async (options) => {
      if (grantPending) { failed = true; throw new Error('fixture: decision flush refused') }
      await flush(options)
    })
    restores.push(() => { appendSpy.mockRestore(); flushSpy.mockRestore() })
    return handle
  }
  const create = state.persistence.create.bind(state.persistence)
  const open = state.persistence.open.bind(state.persistence)
  const createSpy = vi.spyOn(state.persistence, 'create').mockImplementation(async (...args) => intercept(await create(...args)))
  const openSpy = vi.spyOn(state.persistence, 'open').mockImplementation(async (...args) => intercept(await open(...args)))
  try {
    const id = (await state.client.create()).sessionId
    state.steps.push(toolCallResponse('blocked-write', 'write', { file_path: 'blocked.txt', content }))
    const frames: NativeSessionFollowFrame[] = []
    const turn = state.client.prompt(id, 'Write.', true, undefined, (frame) => { frames.push(frame) })
      .then(value => ({ value }), (error: unknown) => ({ error }))
    await vi.waitFor(() => { expect(frames.some(frame => frame.type === 'human')).toBe(true) }, { timeout: 10000, interval: 10 })
    const human = frames.find(frame => frame.type === 'human')
    if (human?.type !== 'human' || human.prompt.kind !== 'approval') throw new Error('missing approval')
    await state.client.answerHuman(id, human.prompt.id, { kind: 'approval', outcome: 'allowed-session' })
    expect(await turn).toHaveProperty('error')
    expect(failed).toBe(true)
    await expect(readFile(join(cwd, 'blocked.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(state.requests).toHaveLength(1)
  } finally {
    createSpy.mockRestore()
    openSpy.mockRestore()
    for (const restore of restores) restore()
    await state.close()
    await cleanup(directory)
  }
}, 30000)
