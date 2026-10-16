import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeAgentId, NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { createLaunchEnvironmentSnapshot, launchEnvironmentProvider } from '@deepseek-ai/dsh-launch-environment/native'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeActiveSessionRegistry } from '@deepseek-ai/dsh-native-session-execution'
import type {} from '@deepseek-ai/dsh-session-telemetry/native-definition'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import { Session, SessionId } from '@deepseek-ai/dsh-session/native'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import { plugin as persistencePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { plugin as messageFeedbackPlugin } from '@deepseek-ai/dsh-message-feedback/native'
import type { NativeMessageFeedbackOperations } from '@deepseek-ai/dsh-message-feedback/native-definition'
import { NativeProgramActiveSession } from '../../../core/native-headless/src/continuation-active-session.ts'
import { NativeContinuationSession } from '../../../core/native-headless/src/continuation-session.ts'
import { plugin } from '../src/native.ts'

it.each([
  { DSH_TELEMETRY_DISABLED: '1' },
  { DSH_TELEMETRY_MODE: 'DISABLED' },
])('honors the process hardoff %o over FEEDBACK_ONLY configuration without constructing an exporter', async (values) => {
  const scope = new NativeScope()
  let sharing: string | undefined
  const consumer: NativePlugin = {
    apiVersion: 1, name: 'telemetry-hardoff-consumer', targets: ['host'], requires: ['sessionTelemetry'], provides: [],
    resolve: () => (context) => { sharing = context.require('sessionTelemetry').sharing },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin, scope, config: { mode: 'FEEDBACK_ONLY', exporter: { url: 'not-an-endpoint' } } },
    { plugin: consumer, scope, config: undefined },
    { plugin: launchEnvironmentProvider(createLaunchEnvironmentSnapshot([{
      source: 'process', values,
    }])), scope, config: undefined },
  ], 'host'))

  try {
    await host.start()
    expect(sharing).toBe('disabled')
  } finally {
    await host.stop()
  }
})


it('drains an accepted delegated feedback prefix through owner release and Native Host stop', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-native-otel-stop-'))
  const captures: {
    resourceLogs: {
      scopeLogs: {
        scope: { name: string }
        logRecords: {
          attributes?: { key: string; value: { stringValue?: string; intValue?: number | string } }[]
          body?: { stringValue?: string }
        }[]
      }[]
    }[]
  }[] = []
  const collector = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk as Buffer))
    request.on('end', () => {
      captures.push(JSON.parse(Buffer.concat(chunks).toString()) as typeof captures[number])
      response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    })
  })
  collector.listen(0, '127.0.0.1')
  await once(collector, 'listening')
  const address = collector.address()
  if (address === null || typeof address === 'string') throw new Error('Native telemetry collector has no port')

  const scope = new NativeScope()
  const agents = new NativeAgentRegistry({ emit() {} })
  const activeSessions = new NativeActiveSessionRegistry(agents)
  let programSignal: AbortSignal | undefined
  const activeProvider: NativePlugin = {
    apiVersion: 1, name: 'native-otel-active-sessions', targets: ['host'], requires: [], provides: ['activeSessions'],
    resolve: () => (context) => {
      programSignal = context.signal
      context.provide('activeSessions', activeSessions)
      context.own(async () => { await activeSessions.dispose(); await agents.dispose() })
    },
  }
  let feedback: NativeMessageFeedbackOperations | undefined
  let persistence: NativeSessionPersistenceOperations | undefined
  const redactionStarted = Promise.withResolvers<undefined>()
  const releaseRedaction = Promise.withResolvers<undefined>()
  const flushReached = Promise.withResolvers<undefined>()
  const releaseFlush = Promise.withResolvers<undefined>()
  let contextSignal: AbortSignal | undefined
  let nestedRedactionCompleted = false
  let holdFeedbackFlush = false
  let committedPrefix: ReturnType<Session['snapshotEvents']> | undefined
  let continuation: NativeContinuationSession | undefined
  let programOwner: NativeProgramActiveSession | undefined
  let releaseRegistration: (() => Promise<void>) | undefined
  let ownerRelease: Promise<void> | undefined
  let releaseAgent: (() => Promise<void>) | undefined
  const releaseProgramOwner = (): Promise<void> => ownerRelease ??= (async () => {
    await releaseRegistration?.()
    await programOwner?.dispose()
  })()
  const redactor: NativePlugin = {
    apiVersion: 1, name: 'native-otel-redactor', targets: ['host'], requires: [], provides: [],
    resolve: () => (context) => {
      contextSignal = context.signal
      context.on('session-telemetry/record', async (record, next) => {
        const deleting = record.attributes['event.type'] === 'feedback/message-delete'
        if (deleting) {
          redactionStarted.resolve(undefined)
          await releaseRedaction.promise
        }
        const downstream = await next()
        if (!deleting) return downstream
        nestedRedactionCompleted = true
        return { ...downstream, body: 'redacted after Host stop' }
      })
    },
  }
  const consumer: NativePlugin = {
    apiVersion: 1, name: 'native-otel-feedback-consumer', targets: ['host'],
    requires: ['messageFeedback', 'sessionPersistence'], provides: [],
    resolve: () => (context) => {
      feedback = context.require('messageFeedback')
      persistence = context.require('sessionPersistence')
      context.own(() => continuation?.close())
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: launchEnvironmentProvider(createLaunchEnvironmentSnapshot([
      { source: 'process', values: { DSH_TELEMETRY_DISABLED: '' } },
    ])), scope, config: undefined },
    { plugin: activeProvider, scope, config: undefined },
    { plugin: persistencePlugin, scope, config: { root, compression: 'none' } },
    { plugin: messageFeedbackPlugin, scope, config: { maxNoteBytes: 1024 } },
    { plugin: redactor, scope, config: undefined },
    { plugin, scope, config: {
      mode: 'FEEDBACK_ONLY',
      exporter: { url: `http://127.0.0.1:${address.port}/v1/logs` },
      processor: { scheduledDelayMillis: 60_000 },
    } },
    { plugin: consumer, scope, config: undefined },
  ], 'host'))

  try {
    await host.start()
    const selectedFeedback = feedback
    const selectedPersistence = persistence
    if (selectedFeedback === undefined || selectedPersistence === undefined) throw new Error('Native feedback services were not selected')
    const session = Session.create(SessionId('native-otel-host-stop'))
    session.append('request/header', { header: { config: { provider: 'mock', model: 'fixture' } }, reason: 'initial' })
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const message = createAssistantMessage({ content: [{ type: 'text', text: 'Stored answer.' }],
      source: { provider: 'mock', model: 'fixture' } })
    session.append('assistant/message', { turn: 1, step: 1, message, stream: [] }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const handle = await selectedPersistence.create(session.header)
    await handle.append(session.snapshotEvents())
    await handle.flush()
    const agent = { id: NativeAgentId(session.id), scope }
    releaseAgent = agents.register(agent)
    const writer = new Proxy(handle, {
      get(target, property) {
        if (property === 'flush') return async () => {
          await target.flush()
          if (!holdFeedbackFlush || session.snapshotEvents().at(-1)?.type !== 'feedback/message-delete') return
          holdFeedbackFlush = false
          committedPrefix = session.snapshotEvents()
          const owner = programOwner
          if (owner === undefined) throw new Error('Native Program owner was not created')
          owner.append('agent/inbox/spliced', {
            target: 'next-turn', start: 0,
            inserted: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Later input.' }] })],
          })
          flushReached.resolve(undefined)
          await releaseFlush.promise
        }
        const value: unknown = Reflect.get(target, property, target)
        if (typeof value !== 'function') return value
        const bound: unknown = value.bind(target)
        return bound
      },
    })
    continuation = NativeContinuationSession.adopt(session, writer, session.snapshotEvents(), [])
    if (programSignal === undefined) throw new Error('Native Program lifetime was not selected')
    programOwner = new NativeProgramActiveSession(agent, continuation,
      'delegated', undefined, {
        signal: programSignal,
        retain: () => () => {},
        retainBackground: () => () => {},
        enqueue: async message => message.id,
        wake: () => { throw new Error('Native Program wake was not expected') },
      })
    releaseRegistration = await activeSessions.register(programOwner)
    const applicationWork = host.run(scope, { kind: 'test' }, async ({ signal }) => {
      const put = await selectedFeedback.put({
        sessionId: session.id, messageId: message.id, rating: 'positive', ifVersion: null,
      }, signal)
      if (!put.ok) throw new Error('durable delegated Native message feedback was rejected')
      holdFeedbackFlush = true
      return selectedFeedback.delete({
        sessionId: session.id, messageId: message.id, ifVersion: put.value.version,
      }, signal)
    })
    await flushReached.promise
    let released = false
    const releasing = releaseProgramOwner().then(() => { released = true })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(released).toBe(false)
    const owner = programOwner
    if (owner === undefined) throw new Error('Native Program owner was not created')
    expect(owner.writerAvailable).toBe(true)
    let stopped = false
    const stopping = host.stop().then(() => { stopped = true })
    expect(contextSignal?.aborted).toBe(true)
    await expect(host.run(scope, { kind: 'late' }, () => 0)).rejects.toThrow('stopped')
    await expect(owner.readEvents()).rejects.toThrow()
    releaseFlush.resolve(undefined)
    await redactionStarted.promise
    expect(released).toBe(false)
    expect(nestedRedactionCompleted).toBe(false)
    expect(stopped).toBe(false)
    expect((await handle.read()).events).toEqual(session.snapshotEvents())
    releaseRedaction.resolve(undefined)
    expect(await applicationWork).toEqual({ ok: true, value: { absent: true } })
    await releasing
    expect(owner.writerAvailable).toBe(false)
    await stopping
    expect(nestedRedactionCompleted).toBe(true)
    const prefix = committedPrefix
    if (prefix === undefined) throw new Error('feedback commit prefix was not captured')
    const records = captures.flatMap(capture => capture.resourceLogs.flatMap(resource => resource.scopeLogs
      .filter(entry => entry.scope.name === '@deepseek-ai/dsh-session-telemetry-otel')
      .flatMap(entry => entry.logRecords)))
    const observed = records.map((record) => {
      const attributes = new Map((record.attributes ?? []).map(attribute => [attribute.key, attribute.value]))
      return [attributes.get('event.type')?.stringValue, Number(attributes.get('event.seq')?.intValue)]
    })
    expect(observed).toEqual(prefix.map(event => [event.type, event.seq]))
    expect(prefix.at(-1)?.type).toBe('feedback/message-delete')
    expect(session.snapshotEvents().at(-1)?.type).toBe('agent/inbox/spliced')
    const deleted = records.find(record => record.attributes?.some(attribute =>
      attribute.key === 'event.type' && attribute.value.stringValue === 'feedback/message-delete'))
    expect(deleted?.body).toEqual({ stringValue: 'redacted after Host stop' })
  } finally {
    releaseFlush.resolve(undefined)
    releaseRedaction.resolve(undefined)
    await releaseProgramOwner()
    await releaseAgent?.()
    await host.stop()
    const closed = once(collector, 'close')
    collector.closeAllConnections()
    collector.close()
    await closed
    rmSync(root, { recursive: true, force: true })
  }
})
