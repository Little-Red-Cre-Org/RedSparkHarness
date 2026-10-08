/** Native first-prompt title provider through the selected headless Program, a routed mock model, and the durable log. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as agentsPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as sessionsPlugin } from '@deepseek-ai/dsh-native-session-execution'
import { plugin as modelExecutionPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as persistencePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { NativeHeadlessApplication, plugin as applicationPlugin } from '@deepseek-ai/dsh-native-headless/native'
import { createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm/native'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { plugin as titlePlugin } from '@deepseek-ai/dsh-session-title/native'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { plugin } from '../src/native.ts'

/** One adapter serving the main conversation and the title purpose from separate scripts. */
class RoutedAdapter extends MockAdapter {
  constructor(script: ConstructorParameters<typeof MockAdapter>[0], readonly titles: MockAdapter) { super(script) }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return options.purpose === 'session-title' ? this.titles.stream(options) : super.stream(options)
  }
}

it('titles the first human prompt with the logged main route and records the request before the call', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rsh-native-first-prompt-title-'))
  const storageRoot = join(root, 'sessions')
  const scope = new NativeScope()
  const titles = new MockAdapter([textResponse('Cache layer refactor')])
  const model = new RoutedAdapter([textResponse('first answer'), textResponse('second answer')], titles)
  let app: NativeHeadlessApplication | undefined
  const capture: NativePlugin = {
    apiVersion: 1, name: 'first-prompt-title-capture', targets: ['host'], requires: ['application'], provides: [],
    resolve: () => (context) => {
      const application = context.require('application')
      if (application instanceof NativeHeadlessApplication) app = application
    },
  }
  const modelProvider: NativePlugin = {
    apiVersion: 1, name: 'first-prompt-title-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => { context.provide('model', model) },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: agentsPlugin, scope, config: undefined }, { plugin: sessionsPlugin, scope, config: undefined },
    { plugin: modelExecutionPlugin, scope, config: undefined }, { plugin: toolsPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: root } },
    { plugin: persistencePlugin, scope, config: { root: storageRoot, compression: 'none' } },
    { plugin: titlePlugin, scope, config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } },
    { plugin, scope, config: { targetWords: 5, targetCjkCharacters: 10, maxInputBytes: 4096, maxOutputTokens: 64, timeoutMs: 60000 } },
    { plugin: modelProvider, scope, config: undefined }, { plugin: capture, scope, config: undefined },
    { plugin: applicationPlugin, scope, config: { cwd: root, provider: 'mock', model: 'fixture', systemPrompt: 'Help.', maxSteps: 2 } },
  ], 'host'))
  const storage = new JsonlSessionBackend({ root: storageRoot, compression: 'none' })
  const id = SessionId('native-first-prompt-title')
  const turn = (resume: boolean, text: string) => app!.executeTurn({
    id, resume, message: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }),
  }, new AbortController().signal)
  try {
    await host.start()
    if (app === undefined) throw new Error('missing native headless')
    await turn(false, 'Please refactor the cache layer for the storage backend')
    await turn(true, 'Now document the new cache layer')
    expect(titles.requests).toHaveLength(1)
    expect(titles.requests[0]).toMatchObject({ provider: 'mock', model: 'fixture', purpose: 'session-title', maxTokens: 64 })
    expect(JSON.stringify(titles.requests[0]?.messages)).toContain('Please refactor the cache layer')
    expect(JSON.stringify(titles.requests[0]?.messages)).not.toContain('Now document')
    expect(model.requests.filter(request => request.purpose === 'session-title')).toHaveLength(0)
    const reader = await storage.open(id, 'read')
    try {
      const events = (await reader.read()).events
      const titleEvents = events.flatMap(event => event.type === 'session/title' ? [event] : [])
      expect(titleEvents.map(event => event.data.source.kind)).toEqual(['fallback', 'provider'])
      expect(titleEvents[1]?.data).toMatchObject({
        title: 'Cache layer refactor',
        source: { kind: 'provider', provider: 'session-title-first-prompt-llm', model: { provider: 'mock', model: 'fixture' } },
      })
      const record = events.find(event => event.type === 'session/title-llm-request')
      expect(record?.data).toMatchObject({ titleProvider: 'session-title-first-prompt-llm', route: { provider: 'mock', model: 'fixture' }, maxTokens: 64 })
      expect(record?.seq).toBeLessThan(titleEvents[1]?.seq ?? 0)
      expect(record?.data.messageSeqs).toEqual(titleEvents[1]?.data.messageSeqs)
    } finally { await reader.close() }
  } finally {
    await host.stop()
    await storage.close()
    await rm(root, { recursive: true, force: true })
  }
}, 15_000)
