/** Real question Consumer through the selected Program and sole durable Session writer. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativeApplication, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as agentsPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as sessionsPlugin } from '@deepseek-ai/dsh-native-session-execution'
import { plugin as modelExecutionPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as persistencePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { plugin as applicationPlugin } from '@deepseek-ai/dsh-native-headless/native'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { plugin as questionsPlugin } from '@deepseek-ai/dsh-user-questions/native'
import { plugin as brokerPlugin } from '@deepseek-ai/dsh-user-question-broker/native'
import { NativeQuestionBroker, type NativePendingQuestion } from '@deepseek-ai/dsh-user-questions/broker'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../Engine/core/agent-loop/tests/mock-adapter.ts'
import { plugin } from '../src/native.ts'

it('persists human answers and replaces the broker after draining its pending presentation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-native-question-'))
  const workspace = join(directory, 'workspace')
  const storageRoot = join(directory, 'sessions')
  await mkdir(workspace)
  const args = { questions: [{ id: 'decision', question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] }] }
  const adapter = new MockAdapter([toolCallResponse('answer', 'ask_user_question', args), textResponse('answered'),
    toolCallResponse('delegate-cancel', 'ask_user_question', args), textResponse('question cancelled'),
    toolCallResponse('broker-cancel', 'ask_user_question', args), textResponse('broker question cancelled'),
    toolCallResponse('replacement-answer', 'ask_user_question', args), textResponse('replacement answered')])
  const scope = new NativeScope()
  let app: NativeApplication | undefined
  let broker: NativeQuestionBroker | undefined
  const capture: NativePlugin = {
    apiVersion: 1, name: 'question-test-capture', targets: ['host'], requires: ['application', 'userQuestionBroker'], provides: [],
    resolve: () => (context) => { app = context.require('application'); broker = context.require('userQuestionBroker') },
  }
  const model: NativePlugin = {
    apiVersion: 1, name: 'question-test-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => { context.provide('model', adapter) },
  }
  const applicationRequest = { plugin: applicationPlugin, scope, config: { cwd: workspace, provider: 'mock', model: 'fixture',
    systemPrompt: 'Ask the human before continuing.', maxSteps: 3 } }
  const brokerRequest = { plugin: brokerPlugin, scope, config: undefined }
  const delegate: NativePlugin = {
    apiVersion: 1, name: 'question-test-delegate', targets: ['host'], requires: ['userQuestions'], provides: [],
    resolve: () => (context) => { context.effect(context.require('userQuestions').registerAnswerer('delegate', {
      ask: (_request, next) => next(),
    }, context.scope)) },
  }
  const delegateRequest = { plugin: delegate, scope, config: undefined }
  const handoff: string[] = []
  const cleanupEntered = Promise.withResolvers<undefined>()
  const releaseCleanup = Promise.withResolvers<undefined>()
  let replacementBroker: NativeQuestionBroker | undefined
  let oldBrokerDisposedAtActivation = false
  let retiredBroker: NativeQuestionBroker | undefined
  const controlledBrokerPlugin: NativePlugin = {
    apiVersion: 1, name: 'controlled-question-broker', targets: ['host'], requires: ['userQuestions'], provides: ['userQuestionBroker'],
    resolve: () => async (context) => {
      const retired = retiredBroker
      if (retired === undefined) throw new Error('retired question broker was not captured')
      expect(() => { retired.onRequest(() => {}) }).toThrow(/disposed/)
      oldBrokerDisposedAtActivation = true
      const controlled = new NativeQuestionBroker()
      replacementBroker = controlled
      context.own(() => controlled.dispose())
      context.provide('userQuestionBroker', controlled)
      context.effect(context.require('userQuestions').registerAnswerer('broker', controlled, context.scope))
      controlled.onRequest((question) => {
        handoff.push('substitute served')
        controlled.answer(question.id, question.request.agent, { answers: [{ id: 'decision', selected: ['No'] }] })
      })
      handoff.push('substitute provider active')
    },
  }
  const requests = [
    { plugin: agentsPlugin, scope, config: undefined }, { plugin: sessionsPlugin, scope, config: undefined },
    { plugin: modelExecutionPlugin, scope, config: undefined }, { plugin: toolsPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: workspace } },
    { plugin: persistencePlugin, scope, config: { root: storageRoot, compression: 'none' } },
    { plugin: questionsPlugin, scope, config: undefined }, delegateRequest, brokerRequest, { plugin, scope, config: undefined },
    { plugin: model, scope, config: undefined }, { plugin: capture, scope, config: undefined },
    applicationRequest,
  ]
  const host = new NativeHost(resolveInstallation(requests, 'host'))
  const storage = new JsonlSessionBackend({ root: storageRoot, compression: 'none' })
  try {
    await host.start()
    if (app === undefined || broker === undefined) throw new Error('missing question composition')
    const application = app
    const questionBroker = broker
    const first = Promise.withResolvers<NativePendingQuestion>()
    const receive = broker.onRequest((question) => { first.resolve(question) })
    const run = host.runOwned(applicationRequest, { kind: 'question-test' }, invocation => application.run(['ask'], invocation.signal))
    const pending = await first.promise
    expect(() => { questionBroker.answer(pending.id, pending.request.agent, { answers: [{ id: 'decision', selected: ['Unknown'] }] }) }).toThrow(/invalid choices/)
    broker.answer(pending.id, pending.request.agent, { answers: [{ id: 'decision', selected: ['Yes'] }] })
    expect(await run).toBe(0)
    receive()
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('Yes')

    const oldBroker = broker
    if (oldBroker === undefined) throw new Error('question broker was not captured')
    const removedDelegateQuestion = Promise.withResolvers<NativePendingQuestion>()
    const receiveRemovedDelegateQuestion = oldBroker.onRequest((question) => { removedDelegateQuestion.resolve(question) })
    const removingDelegate = host.runOwned(applicationRequest, { kind: 'question-test' },
      invocation => application.run(['ask again'], invocation.signal))
    const removedQuestion = await removedDelegateQuestion.promise
    await host.remove(delegateRequest)
    await removingDelegate
    receiveRemovedDelegateQuestion()
    expect(() => { oldBroker.answer(removedQuestion.id, removedQuestion.request.agent, { answers: [] }) }).toThrow(/no pending question/)

    const oldAsk = oldBroker.ask.bind(oldBroker)
    oldBroker.ask = async (request, next) => {
      handoff.push('old request entered')
      try { return await oldAsk(request, next) }
      finally { handoff.push('old request settled') }
    }
    const disposeOld = oldBroker.dispose.bind(oldBroker)
    oldBroker.dispose = async () => {
      handoff.push('old cleanup entered')
      await disposeOld()
      cleanupEntered.resolve(undefined)
      await releaseCleanup.promise
      handoff.push('old cleanup completed')
    }
    const second = Promise.withResolvers<NativePendingQuestion>()
    const receiveSecond = oldBroker.onRequest((question) => { second.resolve(question) })
    const cancelling = host.runOwned(applicationRequest, { kind: 'question-test' }, invocation => application.run(['ask after delegate removal'], invocation.signal))
    const unanswered = await second.promise
    retiredBroker = oldBroker
    const replacementRequest = { plugin: controlledBrokerPlugin, scope, config: undefined }
    let replacementSettled = false
    const replacing = host.replace(resolveInstallation(requests.map(request => request === brokerRequest ? replacementRequest : request), 'host'))
      .then(() => { replacementSettled = true })
    await cleanupEntered.promise
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(replacementSettled).toBe(false)
    expect(replacementBroker).toBeUndefined()
    expect(handoff).toEqual(['old request entered', 'old request settled', 'old cleanup entered'])
    releaseCleanup.resolve(undefined)
    await replacing
    await cancelling
    receiveSecond()
    expect(() => { oldBroker.answer(unanswered.id, unanswered.request.agent, { answers: [] }) }).toThrow(/no pending question/)
    expect(oldBrokerDisposedAtActivation).toBe(true)
    expect(replacementBroker).toBeDefined()
    expect(broker).toBe(replacementBroker)
    expect(handoff).toEqual([
      'old request entered', 'old request settled', 'old cleanup entered', 'old cleanup completed', 'substitute provider active',
    ])

    await host.runOwned(applicationRequest, { kind: 'question-test' }, invocation => application.run(['ask again'], invocation.signal))
    expect(handoff).toEqual([
      'old request entered', 'old request settled', 'old cleanup entered', 'old cleanup completed',
      'substitute provider active', 'substitute served',
    ])
    expect(JSON.stringify(adapter.requests[7]?.messages)).toContain('No')
    const stored = await storage.list()
    expect(stored).toHaveLength(4)
    const results = []
    for (const snapshot of stored) {
      const reader = await storage.open(SessionId(snapshot.header.id), 'read')
      try { results.push(...(await reader.read()).events.filter(event => event.type === 'tool/result')) }
      finally { await reader.close() }
    }
    expect(results).toHaveLength(4)
    expect(results.filter(event => event.data.error?.code === 'ASK_ABORTED')).toHaveLength(2)
    expect(results.find(event => event.data.message.source.kind === 'tool'
      && event.data.message.source.callId === ToolCallId('delegate-cancel'))).toMatchObject({ data: { error: { code: 'ASK_ABORTED' } } })
    expect(JSON.stringify(results)).toContain('Yes')
    expect(JSON.stringify(results)).toContain('No')
  } finally {
    releaseCleanup.resolve(undefined)
    await host.stop()
    await storage.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 15_000)
