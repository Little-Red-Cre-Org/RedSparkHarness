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
import { plugin as questionsPlugin } from '@deepseek-ai/dsh-user-questions/native'
import { plugin as brokerPlugin } from '@deepseek-ai/dsh-user-question-broker/native'
import type { NativeQuestionBroker, NativePendingQuestion } from '@deepseek-ai/dsh-user-questions/broker'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../Engine/core/agent-loop/tests/mock-adapter.ts'
import { plugin } from '../src/native.ts'

it('persists a human answer and drains its broker presentation when the delegating answerer is removed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-native-question-'))
  const workspace = join(directory, 'workspace')
  const storageRoot = join(directory, 'sessions')
  await mkdir(workspace)
  const args = { questions: [{ id: 'decision', question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] }] }
  const adapter = new MockAdapter([toolCallResponse('answer', 'ask_user_question', args), textResponse('answered'),
    toolCallResponse('cancel', 'ask_user_question', args), textResponse('question cancelled')])
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
  const host = new NativeHost(resolveInstallation([
    { plugin: agentsPlugin, scope, config: undefined }, { plugin: sessionsPlugin, scope, config: undefined },
    { plugin: modelExecutionPlugin, scope, config: undefined }, { plugin: toolsPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: workspace } },
    { plugin: persistencePlugin, scope, config: { root: storageRoot, compression: 'none' } },
    { plugin: questionsPlugin, scope, config: undefined }, delegateRequest, brokerRequest, { plugin, scope, config: undefined },
    { plugin: model, scope, config: undefined }, { plugin: capture, scope, config: undefined },
    applicationRequest,
  ], 'host'))
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
    const second = Promise.withResolvers<NativePendingQuestion>()
    broker.onRequest((question) => { second.resolve(question) })
    const cancelling = host.runOwned(applicationRequest, { kind: 'question-test' }, invocation => application.run(['ask again'], invocation.signal))
    const unanswered = await second.promise
    const settled = await Promise.allSettled([host.remove(delegateRequest), cancelling])
    expect(settled.map(item => item.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(() => { questionBroker.answer(unanswered.id, unanswered.request.agent, { answers: [] }) }).toThrow(/no pending question/)
    const stored = await storage.list()
    expect(stored).toHaveLength(2)
    const results = []
    for (const snapshot of stored) {
      const reader = await storage.open(SessionId(snapshot.header.id), 'read')
      try { results.push(...(await reader.read()).events.filter(event => event.type === 'tool/result')) }
      finally { await reader.close() }
    }
    expect(results).toHaveLength(2)
    expect(results.some(event => event.data.error?.code === 'ASK_ABORTED')).toBe(true)
    expect(JSON.stringify(results)).toContain('Yes')
  } finally {
    await host.stop()
    await storage.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 15_000)
