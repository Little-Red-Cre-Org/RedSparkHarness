/** One question settlement retains other presentations and their borrowed turn signals. */
import { expect, it, vi } from 'vitest'
import { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentId } from '@deepseek-ai/dsh-native-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session/native'
import { NativeWebHumanInteraction } from '../src/human.ts'
import { NativeSessionFeed } from '../src/follow.ts'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NativeHost, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as agents } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as execution } from '@deepseek-ai/dsh-native-session-execution/native'
import { plugin as modelExecution } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as tools } from '@deepseek-ai/dsh-native-tools/native'
import { plugin as questions } from '@deepseek-ai/dsh-user-questions/native'
import { plugin as askUser } from '@deepseek-ai/dsh-tool-ask-user/native'
import { plugin as filesystem } from '@deepseek-ai/dsh-fs-local/native'
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
import type { NativeWebHumanPrompt } from '@deepseek-ai/dsh-client-native-session/human'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials/native'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm/native'
import { toolCallResponse, textResponse } from '../../../../../Engine/core/agent-loop/tests/mock-adapter.ts'
import { plugin } from '../src/native.ts'

it.each([{ choice: 'Keep' }])('cancels only the exact question and keeps other waits answerable ($choice)', async ({ choice }) => {
  const human = new NativeWebHumanInteraction(3, () => {})
  const agent = { id: NativeAgentId('question-owner'), scope: new NativeScope() }
  const other = { id: NativeAgentId('other-owner'), scope: new NativeScope() }
  const session = Session.create(SessionId('question-owner'))
  const otherSession = Session.create(SessionId('other-owner'))
  const turn = new AbortController()
  const otherTurn = new AbortController()
  const feed = new NativeSessionFeed(65536, (error) => { throw error })
  const otherFeed = new NativeSessionFeed(65536, (error) => { throw error })
  const frames = vi.spyOn(feed, 'push')
  const otherFrames = vi.spyOn(otherFeed, 'push')
  const question = { id: 'decision', question: 'Proceed?', options: [{ label: choice }] }
  const first = human.questions({ agent, session, questions: [question], signal: turn.signal }, feed)
    .then(answer => ({ answer }), (error: unknown) => ({ error }))
  const second = human.questions({ agent, session, questions: [question], signal: turn.signal }, feed)
  const third = human.questions({ agent: other, session: otherSession, questions: [question], signal: otherTurn.signal }, otherFeed)
  const prompt = frames.mock.calls[0]?.[0]
  const otherPrompt = otherFrames.mock.calls[0]?.[0]
  if (prompt?.type !== 'human' || otherPrompt?.type !== 'human') throw new Error('missing initial question presentations')
  try {
    expect(() => { human.answer(prompt.prompt.id, other, { kind: 'cancel-questions' }) }).toThrow('another owner')
    expect(() => { human.answer(prompt.prompt.id, agent, { kind: 'cancel-questions', answer: {} }) }).toThrow('invalid fields')
    human.answer(prompt.prompt.id, agent, { kind: 'cancel-questions' })
    await expect(first).resolves.toMatchObject({ error: { name: 'UserQuestionError', code: 'ASK_CANCELLED' } })
    expect(turn.signal.aborted).toBe(false)
    expect(otherTurn.signal.aborted).toBe(false)
    expect(otherFrames.mock.calls.map(([frame]) => frame.type)).toEqual(['human'])
    const next = frames.mock.calls.find(([frame]) => frame.type === 'human' && frame.prompt.id !== prompt.prompt.id)?.[0]
    if (next?.type !== 'human') throw new Error('next question was withdrawn with its predecessor')
    expect(() => { human.answer(prompt.prompt.id, agent, { kind: 'cancel-questions' }) }).toThrow('stale')
    const answer = { kind: 'questions', answer: { answers: [{ id: question.id, selected: [choice] }] } }
    human.answer(next.prompt.id, agent, answer)
    human.answer(otherPrompt.prompt.id, other, answer)
    await expect(second).resolves.toEqual(answer.answer)
    await expect(third).resolves.toEqual(answer.answer)
    expect(frames.mock.calls.filter(([frame]) => frame.type === 'human-removed' && frame.id === prompt.prompt.id)).toHaveLength(1)
  } finally {
    human.close()
    await Promise.allSettled([first, second, third])
    frames.mockRestore()
    otherFrames.mockRestore()
  }
})

it.each([{ choice: 'Keep' }])('continues the same native turn after authenticated question cancellation ($choice)', async ({ choice }) => {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-question-cancel-'))
  const cwd = join(directory, 'work')
  await mkdir(cwd)
  const scope = new NativeScope()
  let web: NativeHttpHost | undefined
  const requests: GenerateOptions[] = []
  const continued = Promise.withResolvers<GenerateOptions>()
  const release = Promise.withResolvers<undefined>()
  const model: NativePlugin = {
    apiVersion: 1, name: 'question-cancel-fixture-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => {
      context.provide('model', {
        async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
          requests.push(request)
          const results = request.messages.flatMap(message => message.content).filter(block => block.type === 'tool-result')
          if (results.length === 0) {
            yield* toolCallResponse('question', 'ask_user_question', {
              questions: [{ id: 'decision', question: 'Proceed?', options: [{ label: choice }] }],
            })
            return
          }
          if (results.some(result => result.isError)) {
            continued.resolve(request)
            await release.promise
          }
          yield* textResponse('Continued in the same turn.')
        },
      })
    },
  }
  const carrier: NativePlugin = {
    apiVersion: 1, name: 'question-cancel-fixture-carrier', targets: ['host'], requires: [], provides: ['hostConnection', 'httpRoutes'],
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
    { plugin, scope, config: { cwd, provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.', maxSteps: 3, builtinTools: false,
      maxPendingRequests: 2, maxHistoryEvents: 100, maxPromptChars: 100, maxFollowBufferBytes: 1000000,
      maxFollowers: 4, maxPendingHumanRequests: 2 } },
    ...[agents, execution, modelExecution, tools, questions, askUser, model, carrier, workspaceRegistry, storageHub]
      .map(plugin => ({ plugin, scope, config: undefined })),
    { plugin: filesystem, scope, config: { cwd } },
    { plugin: storage, scope, config: { root: join(directory, 'sessions'), compression: 'none' } },
    { plugin: storageJson, scope, config: { root: join(directory, 'domains') } },
    { plugin: storageDomain, scope, config: { backend: 'json' } },
  ], 'host'))
  let client: ReturnType<typeof createNativeSessionClient> | undefined
  const turns: Promise<unknown>[] = []
  try {
    await host.start()
    if (web === undefined) throw new Error('missing HTTP Host')
    const url = web.url
    const login = await fetch(web.connection.authenticatedUrl(url), { redirect: 'manual' })
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    if (cookie === undefined) throw new Error('missing browser authentication')
    const admissions = new Map<string, string>()
    const calls: string[] = []
    const rpc = createWebConnectionRpc(async (input, init) => {
      if (input.pathname.endsWith('/session/start')) {
        const envelope = JSON.parse(init.body as string) as { payload: { sessionId: string } }
        const headers = new Headers(init.headers)
        headers.set('cookie', cookie)
        const response = await fetch(new URL(input.pathname, url), { ...init, headers })
        const reply = await response.clone().json() as { result: { ok: boolean; value?: { admissionId: string } } }
        if (reply.result.ok && reply.result.value !== undefined) admissions.set(envelope.payload.sessionId, reply.result.value.admissionId)
        calls.push(input.pathname)
        return response
      }
      calls.push(input.pathname)
      const headers = new Headers(init.headers)
      headers.set('cookie', cookie)
      return fetch(new URL(input.pathname, url), { ...init, headers })
    })
    client = createNativeSessionClient(rpc, { maxFollowBufferChars: 1000000 })
    const left = (await client.create()).sessionId
    const right = (await client.create()).sessionId
    const frames: NativeSessionFollowFrame[] = []
    const otherFrames: NativeSessionFollowFrame[] = []
    const leftTurn = client.prompt(left, 'Ask me.', true, undefined, (frame) => { frames.push(frame) })
      .then(value => ({ value }), (error: unknown) => ({ error }))
    const rightTurn = client.prompt(right, 'Ask me.', true, undefined, (frame) => { otherFrames.push(frame) })
      .then(value => ({ value }), (error: unknown) => ({ error }))
    turns.push(leftTurn, rightTurn)
    let first!: NativeWebHumanPrompt
    let other!: NativeWebHumanPrompt
    await vi.waitFor(() => {
      const a = frames.find(frame => frame.type === 'human')
      const b = otherFrames.find(frame => frame.type === 'human')
      expect(a?.type).toBe('human')
      expect(b?.type).toBe('human')
      if (a?.type === 'human' && b?.type === 'human') { first = a.prompt; other = b.prompt }
    }, { timeout: 10000, interval: 10 })
    const signal = new AbortController().signal
    await expect(rpc.call('/api', 'session/answer-human', { sessionId: left, admissionId: admissions.get(right), id: first.id,
      answer: { kind: 'cancel-questions' } }, signal)).resolves.toMatchObject({ ok: false })
    await expect(client.answerHuman(right, first.id, { kind: 'cancel-questions' })).rejects.toThrow('another owner')
    await client.answerHuman(left, first.id, { kind: 'cancel-questions' })
    const next = await continued.promise
    expect(next.signal?.aborted).toBe(false)
    const cancellation = next.messages.flatMap(message => message.content).find(block => block.type === 'tool-result' && block.isError)
    expect(cancellation).toMatchObject({ type: 'tool-result', toolCallId: 'question', isError: true })
    expect(JSON.stringify(cancellation)).toContain('the user cancelled ask_user_question')
    expect(await client.status(left)).toEqual({ status: 'running' })
    expect(await client.status(right)).toEqual({ status: 'running' })
    expect(otherFrames.filter(frame => frame.type === 'human-removed')).toHaveLength(0)
    await expect(client.answerHuman(left, first.id, { kind: 'cancel-questions' })).rejects.toThrow('stale')
    await client.answerHuman(right, other.id, { kind: 'questions', answer: { answers: [{ id: 'decision', selected: [choice] }] } })
    await expect(rightTurn).resolves.toMatchObject({ value: { exitCode: 0, answer: 'Continued in the same turn.' } })
    release.resolve(undefined)
    await expect(leftTurn).resolves.toMatchObject({ value: { exitCode: 0, answer: 'Continued in the same turn.' } })
    const history = (await client.history(left)).events
    expect(history.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(history.filter(event => event.type === 'tool/result')).toMatchObject([{ data: { error: { code: 'ASK_CANCELLED' } } }])
    expect(history.filter(event => event.type === 'turn/end')).toHaveLength(1)
    expect(calls.filter(path => path.endsWith('/session/cancel'))).toHaveLength(0)
    expect(requests.filter(request => request.sessionId === left)).toHaveLength(2)
    await expect(client.answerHuman(left, first.id, { kind: 'cancel-questions' })).rejects.toThrow('no owned turn')
  } finally {
    release.resolve(undefined)
    await client?.close()
    await host.stop()
    await Promise.allSettled(turns)
    if (!directory.startsWith(join(tmpdir(), 'rsh-question-cancel-'))) throw new Error('unexpected fixture cleanup target')
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)
