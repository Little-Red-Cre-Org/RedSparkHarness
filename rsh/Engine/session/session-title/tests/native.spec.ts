/** Native session titles through the selected headless Program and the Session's sole durable writer. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type InstallationRequest, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as agentsPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as sessionsPlugin } from '@deepseek-ai/dsh-native-session-execution'
import { plugin as modelExecutionPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as persistencePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import { NativeHeadlessApplication, plugin as applicationPlugin } from '@deepseek-ai/dsh-native-headless/native'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session/native'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import {
  plugin as titlePlugin, SessionTitleProviderId, type NativeSessionTitleProvider, type NativeSessionTitleRequest,
  type NativeSessionTitles,
} from '../src/native.ts'

const CONFIG = { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 }

afterEach(() => { vi.restoreAllMocks() })

/** Compose the shipped native headless Providers with the title service and an optional inline provider. */
async function fixture(script: ConstructorParameters<typeof MockAdapter>[0], provider?: NativeSessionTitleProvider) {
  const root = await mkdtemp(join(tmpdir(), 'rsh-native-title-'))
  const scope = new NativeScope()
  const model = new MockAdapter(script)
  let app: NativeHeadlessApplication | undefined
  let titles: NativeSessionTitles | undefined
  let storage: NativeSessionPersistenceOperations | undefined
  const capture: NativePlugin = {
    apiVersion: 1, name: 'title-test-capture', targets: ['host'],
    requires: ['application', 'sessionTitles', 'sessionPersistence'], provides: [],
    resolve: () => (context) => {
      const application = context.require('application')
      if (!(application instanceof NativeHeadlessApplication)) throw new Error('missing native headless')
      app = application
      titles = context.require('sessionTitles')
      storage = context.require('sessionPersistence')
    },
  }
  const modelProvider: NativePlugin = {
    apiVersion: 1, name: 'title-test-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => { context.provide('model', model) },
  }
  const providerPlugin: NativePlugin = {
    apiVersion: 1, name: 'title-test-provider', targets: ['host'], requires: ['sessionTitles'], provides: [],
    resolve: () => (context) => { if (provider !== undefined) context.effect(context.require('sessionTitles').register(provider)) },
  }
  const installation: InstallationRequest[] = [
    { plugin: agentsPlugin, scope, config: undefined }, { plugin: sessionsPlugin, scope, config: undefined },
    { plugin: modelExecutionPlugin, scope, config: undefined }, { plugin: toolsPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: root } },
    { plugin: persistencePlugin, scope, config: { root: join(root, 'sessions'), compression: 'none' } },
    { plugin: titlePlugin, scope, config: CONFIG },
    ...provider === undefined ? [] : [{ plugin: providerPlugin, scope, config: undefined }],
    { plugin: modelProvider, scope, config: undefined }, { plugin: capture, scope, config: undefined },
    { plugin: applicationPlugin, scope, config: { cwd: root, provider: 'mock', model: 'fixture', systemPrompt: 'Help.', maxSteps: 3 } },
  ]
  const host = new NativeHost(resolveInstallation(installation, 'host'))
  await host.start()
  if (app === undefined || titles === undefined || storage === undefined) throw new Error('missing title composition')
  const application = app
  const persistence = storage
  return {
    model, app: application, titles,
    turn: (id: SessionId, resume: boolean, text: string) => application.executeTurn({
      id, resume, message: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }),
    }, new AbortController().signal),
    async events(id: SessionId): Promise<readonly SessionEvent[]> {
      const reader = await persistence.open(id, 'read')
      try { return (await reader.read()).events } finally { await reader.close() }
    },
    async close() { await host.stop(); await rm(root, { recursive: true, force: true }) },
  }
}

function titleEvents(events: readonly SessionEvent[]) {
  return events.flatMap(event => event.type === 'session/title' ? [event.data] : [])
}

it('commits the deterministic fallback after the first human message without a provider', async () => {
  const state = await fixture([textResponse('first answer'), textResponse('second answer')])
  const id = SessionId('native-title-fallback')
  try {
    await state.turn(id, false, 'Please refactor the cache layer for the storage backend')
    await state.turn(id, true, 'And then document it')
    const titles = titleEvents(await state.events(id))
    expect(titles).toHaveLength(1)
    expect(titles[0]).toMatchObject({ title: 'Please refactor the cache layer', source: { kind: 'fallback' } })
    expect(state.model.requests).toHaveLength(2)
  } finally { await state.close() }
})

it('runs a first-prompt provider with the logged main route and keeps the title durable before the turn settles', async () => {
  const calls: NativeSessionTitleRequest[] = []
  const provider: NativeSessionTitleProvider = {
    id: SessionTitleProviderId('inline-title'), automatic: 'first-prompt',
    async generate(request) {
      calls.push(request)
      await request.appendEvent('session/title-llm-request', {
        titleProvider: SessionTitleProviderId('inline-title'), messageSeqs: request.messages.map(message => message.seq),
        route: { provider: 'mock', model: 'fixture' }, system: 'Title it.', messages: [], maxTokens: 8,
      })
      return { title: '  Cache   layer refactor ', messageSeqs: request.messages.map(message => message.seq),
        ...request.route === undefined ? {} : { model: request.route } }
    },
  }
  const state = await fixture([textResponse('first answer'), textResponse('second answer')], provider)
  const id = SessionId('native-title-provider')
  try {
    await state.turn(id, false, 'Please refactor the cache layer for the storage backend')
    const events = await state.events(id)
    const titles = titleEvents(events)
    expect(titles.map(title => title.source.kind)).toEqual(['fallback', 'provider'])
    expect(titles[1]).toMatchObject({
      title: 'Cache layer refactor',
      source: { kind: 'provider', provider: 'inline-title', model: { provider: 'mock', model: 'fixture' } },
    })
    const firstMessage = events.find(event => event.type === 'user/message')
    expect(titles[1]?.messageSeqs).toEqual([firstMessage?.seq])
    const record = events.findIndex(event => event.type === 'session/title-llm-request')
    expect(record).toBeGreaterThan(events.findIndex(event => event.type === 'request/header'))
    expect(record).toBeLessThan(events.findLastIndex(event => event.type === 'session/title'))
    expect(calls[0]?.route).toEqual({ provider: 'mock', model: 'fixture' })
    await state.turn(id, true, 'Second prompt never retitles')
    expect(calls).toHaveLength(1)
  } finally { await state.close() }
})

it('pins an explicit rename against later all-prompts revisions until an explicit refresh', async () => {
  let revision = 0
  const provider: NativeSessionTitleProvider = {
    id: SessionTitleProviderId('inline-all'), automatic: 'all-prompts',
    generate: async request => ({ title: `Revision ${++revision}`, messageSeqs: request.messages.map(message => message.seq) }),
  }
  const state = await fixture([textResponse('one'), textResponse('two')], provider)
  const id = SessionId('native-title-rename')
  try {
    await state.turn(id, false, 'Start a migration plan')
    const renamed = await state.app.executeSessionOperation({ id, resume: true }, async (owner) => {
      expect(state.titles.get(owner.agent)?.title).toBe('Revision 1')
      return await state.titles.rename(owner, '  My   pinned title ')
    }, new AbortController().signal)
    expect(renamed).toMatchObject({ title: 'My pinned title', source: { kind: 'user' } })
    await state.turn(id, true, 'Continue the migration plan')
    expect(revision).toBe(1)
    const titles = titleEvents(await state.events(id))
    expect(titles.at(-1)).toMatchObject({ title: 'My pinned title', source: { kind: 'user' }, messageSeqs: [] })
    // Explicit refresh is the deliberate unpin: it reruns the provider over every eligible message.
    const refreshed = await state.app.executeSessionOperation({ id, resume: true },
      async owner => await state.titles.refresh(owner), new AbortController().signal)
    expect(refreshed).toMatchObject({ title: 'Revision 2', source: { kind: 'provider', provider: 'inline-all' } })
    expect(refreshed?.messageSeqs).toHaveLength(2)
    expect(titleEvents(await state.events(id)).at(-1)).toMatchObject({ title: 'Revision 2' })
  } finally { await state.close() }
})

it('keeps the fallback and the turn result when the provider fails', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const provider: NativeSessionTitleProvider = {
    id: SessionTitleProviderId('inline-failing'), automatic: 'first-prompt',
    generate: async () => { throw new Error('title model unavailable') },
  }
  const state = await fixture([textResponse('answer')], provider)
  const id = SessionId('native-title-failure')
  try {
    const result = await state.turn(id, false, 'Investigate flaky tests')
    expect(result).toBeDefined()
    expect(titleEvents(await state.events(id))).toEqual([expect.objectContaining({ title: 'Investigate flaky tests', source: { kind: 'fallback' } })])
    expect(warn.mock.calls.flat().join('\n')).toContain('title model unavailable')
  } finally { await state.close() }
})
