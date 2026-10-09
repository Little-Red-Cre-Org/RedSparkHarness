import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin, type NativeServices } from '@deepseek-ai/dsh-native-runtime'
import {
  SessionId,
  SessionLogOffset,
  SessionSeq,
  SESSION_FORMAT_VERSION,
  type Session,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session/native'
import { NativeAgentId } from '@deepseek-ai/dsh-native-agent'
import type { NativeToolExecution, NativeValueToolContribution } from '@deepseek-ai/dsh-native-tools'
import type {
  SessionEventSearchRequest,
  SessionEventTraceObservation,
  SessionEventWindow,
  SessionLineageTrace,
  SessionQueryOperations,
  SessionRecord,
} from '@deepseek-ai/dsh-session-query/native'
import { DEFAULT_SEARCH_TIMEOUT_MS, plugin, resolveNativeToolSessionQueryConfig } from '../src/native.ts'
import type {} from '@deepseek-ai/dsh-native-agent/turn-boundary'
import type {} from '@deepseek-ai/dsh-native-prompt/native'
import type {} from '@deepseek-ai/dsh-session-projection/native'
import type {} from '@deepseek-ai/dsh-native-tools/native'

function serviceProvider<K extends keyof NativeServices>(key: K, service: NativeServices[K], suffix = ''): NativePlugin {
  return {
    apiVersion: 1,
    name: `fixture-${key}${suffix}`,
    targets: ['host'],
    requires: [],
    provides: [key],
    resolve: () => (context) => { context.provide(key, service) },
  }
}

it('rejects unknown Native tool configuration fields', () => {
  expect(() => resolveNativeToolSessionQueryConfig({ unexpected: true }))
    .toThrow('tool-session-query: unknown configuration field unexpected')
})

it.each([
  ['null', null],
  ['array', []],
  ['primitive', 'invalid'],
] as const)('rejects non-object Native tool configuration at plugin resolution: %s', (_kind, input) => {
  expect(() => plugin.resolve(input)).toThrow('tool-session-query: configuration must be an object')
})

it.each([
  { label: 'accepts the observed caller workspace', observedCwd: '/workspace', rejected: false },
  { label: 'rejects an observed header moved outside the caller workspace', observedCwd: '/other', rejected: true },
])('registers and executes Native query tools: $label', async ({ observedCwd, rejected }) => {
  const root = new NativeScope()
  const tools = new Map<string, NativeValueToolContribution>()
  const queryHeader: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: SessionId('caller'),
    createdAt: 10,
    isSeeded: false,
    cwd: '/workspace',
  }
  const observedHeader = { ...queryHeader, cwd: observedCwd }
  const session = { id: queryHeader.id, header: queryHeader } as Session
  const sessionRecord: SessionRecord = { header: queryHeader, live: true, persisted: false }
  const sessionTrace: SessionLineageTrace = {
    target: sessionRecord,
    ancestors: [],
    descendants: [],
    complete: true,
    root: sessionRecord,
  }
  const targetEvent: SessionEvent = { type: 'turn/start', seq: SessionSeq(0), time: 10, data: { turn: 1 } }
  const eventTrace: SessionEventTraceObservation = {
    session: queryHeader,
    target: { sessionId: queryHeader.id, seq: targetEvent.seq, type: targetEvent.type, time: targetEvent.time, surface: 'current' },
    replacementChain: [],
    replacedEventSeqs: [],
    sourceEventSeqs: [],
    derivedEventSeqs: [],
  }
  const eventWindow: SessionEventWindow = {
    session: queryHeader,
    inheritedEventCount: SessionLogOffset(0),
    target: targetEvent,
    events: [targetEvent],
    startSeq: targetEvent.seq,
    endSeq: targetEvent.seq,
  }
  let observedRequest: SessionEventSearchRequest | undefined
  let observedProjection: { readonly session: Session; readonly key: string } | undefined
  const query = {
    searchSessions: async () => ({ items: [] }),
    readTitleSnapshots: async (ids: readonly SessionEventSearchRequest['sessionId'][]) => ids.map(sessionId => ({
      sessionId,
      status: 'fulfilled' as const,
      value: { session: queryHeader },
    })),
    searchEvents: async (request: SessionEventSearchRequest) => {
      observedRequest = request
      return { session: observedHeader, items: [] }
    },
    traceSession: async () => sessionTrace,
    traceEvent: async () => eventTrace,
    readEvent: async () => eventWindow,
  } as unknown as SessionQueryOperations
  const projections = {
    stateOf: (observedSession: Session, key: 'turnBoundary') => {
      observedProjection = { session: observedSession, key }
      return {
        openTurnStartSeq: SessionSeq(0),
        lastStepStartSeq: SessionSeq(7),
        lastStepBoundary: { kind: 'start' as const, seq: SessionSeq(7) },
        lastTurn: 1,
      }
    },
  } as unknown as NativeServices['sessionProjections']
  type PromptSection = Parameters<NativeServices['promptSections']['register']>[0]
  let promptSection: PromptSection | undefined
  const promptSections = {
    register(section: PromptSection) {
      promptSection = section
      return () => { promptSection = undefined }
    },
  } as unknown as NativeServices['promptSections']
  const toolRegistry = {
    registerValueTool(contribution: NativeValueToolContribution) {
      tools.set(contribution.schema.name, contribution)
      return async () => { tools.delete(contribution.schema.name) }
    },
  } as unknown as NativeServices['tools']
  const installations = [
    { plugin: serviceProvider('sessionQuery', query), scope: root, config: undefined },
    { plugin: serviceProvider('sessionProjections', projections), scope: root, config: undefined },
    { plugin: serviceProvider('promptSections', promptSections), scope: root, config: undefined },
    { plugin: serviceProvider('tools', toolRegistry), scope: root, config: undefined },
    { plugin, scope: root, config: undefined },
  ]
  expect(installations.map(request => request.plugin?.name)).toEqual([
    'fixture-sessionQuery', 'fixture-sessionProjections', 'fixture-promptSections', 'fixture-tools',
    '@deepseek-ai/dsh-tool-session-query',
  ])
  const host = new NativeHost(resolveInstallation(installations, 'host'))
  await host.start()
  try {
    expect([...tools.keys()]).toEqual([
      'session_search', 'session_event_search', 'session_trace', 'session_event_trace', 'session_event_read',
    ])
    const contribution = (name: string): NativeValueToolContribution => {
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`Native ${name} was not registered`)
      return tool
    }
    const makeCall = (name: string, arguments_: unknown): NativeToolExecution => ({
      agent: { id: NativeAgentId('query-agent'), scope: root },
      callId: 'native-query-call',
      name,
      arguments: arguments_,
      session,
      signal: new AbortController().signal,
      appendEvent: async () => { throw new Error('read-only session-query tool attempted to append an event') },
    } as unknown as NativeToolExecution)
    const invoke = (name: string, arguments_: unknown) => contribution(name).execute(makeCall(name, arguments_))
    const tool = contribution('session_event_search')
    const call = makeCall('session_event_search', { query: 'needle' })
    expect(contribution('session_search').timeoutMs).toBe(DEFAULT_SEARCH_TIMEOUT_MS)
    expect(contribution('session_event_search').timeoutMs).toBe(DEFAULT_SEARCH_TIMEOUT_MS)
    expect(contribution('session_trace').timeoutMs).toBeUndefined()
    for (const name of ['session_search', 'session_event_search']) {
      expect(contribution(name).isConcurrencySafe).toBeUndefined()
    }
    for (const name of ['session_trace', 'session_event_trace', 'session_event_read']) {
      expect(contribution(name).isConcurrencySafe?.({})).toBe(true)
    }
    expect(await promptSection?.text(root)).toContain('Use session_search')
    expect(() => contribution('session_trace').output.render(makeCall('session_trace', {}), null))
      .toThrow('tool-session-query: tool result must be text')
    if (rejected) {
      await expect(tool.execute(call)).rejects.toMatchObject({ code: 'SESSION_QUERY_TOOL_UNAUTHORIZED' })
    } else {
      const value = await tool.execute(call)
      expect(observedProjection).toEqual({ session, key: 'turnBoundary' })
      expect(observedRequest?.filters).toContainEqual({ kind: 'seq', to: 6 })
      if (typeof value !== 'string') throw new TypeError('Native query tool did not return its canonical text value')
      expect(tool.output.render(call, value).content).toEqual([{ type: 'text', text: value }])
      expect(await invoke('session_search', { query: 'needle' })).toBe('No prior session matches found.')
      expect(await invoke('session_trace', {})).toContain('Ancestors (nearest first):')
      expect(await invoke('session_event_trace', { seq: 0 })).toContain('Target: seq 0 | turn/start | current')
      expect(await invoke('session_event_read', { seq: 0 })).toContain('Target event seq 0:')
    }
  } finally {
    await host.stop()
  }
})
