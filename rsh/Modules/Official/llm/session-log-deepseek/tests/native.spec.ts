import { expect, it } from 'vitest'
import { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import { SESSION_FORMAT_VERSION, Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session/native'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution/active-session-protocol'
import type { DeepSeekLlmApiExtensionRequest } from '@deepseek-ai/dsh-deepseek-llm-api-extensions/types'
import type { NativeDeepSeekLlmApiExtensions } from '@deepseek-ai/dsh-deepseek-llm-api-extensions/native'
import { plugin as NativeSessionLog } from '../src/native.ts'

declare const nativeRegistry: NativeDeepSeekLlmApiExtensions
type Provider = Parameters<typeof nativeRegistry.register<'dsh_session_log'>>[2]

async function nativeHarness(flushFailure?: Error) {
  const sessionId = SessionId('native-session-log')
  const session = Session.create(sessionId, undefined, {
    id: sessionId, version: SESSION_FORMAT_VERSION, createdAt: 0, isSeeded: false,
  })
  const first = session.append('turn/start', { turn: 1 })
  const events: SessionEvent[] = [first]
  let durableEvents: readonly SessionEvent[] = [first]
  let currentOwner: NativeActiveSessionOwner | undefined
  const readStarted = Promise.withResolvers<readonly SessionEvent[]>()
  const releaseRead = Promise.withResolvers<undefined>()
  const flushStarted = Promise.withResolvers<readonly SessionEvent[]>()
  const releaseFlush = Promise.withResolvers<undefined>()
  const agent = { scope: new NativeScope() } as unknown as NativeActiveSessionOwner['agent']
  const owner = {
    agent,
    session,
    writerAvailable: true,
    async readEvents() {
      const snapshot = [...durableEvents]
      readStarted.resolve(snapshot)
      await releaseRead.promise
      return snapshot
    },
    append(type: string, data: unknown) {
      if (type !== 'session-log-deepseek/delivery-accepted') throw new Error(`unexpected Session event: ${type}`)
      const event = session.append('session-log-deepseek/delivery-accepted', data as never)
      events.push(event)
      return event
    },
    async flush() {
      const snapshot = [...events]
      flushStarted.resolve(snapshot)
      if (flushFailure !== undefined) throw flushFailure
      await releaseFlush.promise
      durableEvents = snapshot
    },
  } as unknown as NativeActiveSessionOwner
  currentOwner = owner
  const operations = {
    owners: () => currentOwner === undefined ? [] : [currentOwner],
    owner: (requestedAgent: NativeActiveSessionOwner['agent'], requestedSession: Session) =>
      currentOwner?.agent === requestedAgent && currentOwner.session === requestedSession ? currentOwner : undefined,
  } as unknown as NativeActiveSessionOperations

  const scope = new NativeScope()
  let provider: Provider | undefined
  let registered = false
  const extensions = {
    register(registrationScope: NativeScope, field: string, contribution: Provider) {
      if (registrationScope !== scope || field !== 'dsh_session_log') throw new Error('unexpected Native contribution')
      provider = contribution
      registered = true
      return () => { registered = false }
    },
  }
  const services = new Map<string, unknown>([
    ['deepseekLlmApiExtensions', extensions],
    ['activeSessions', operations],
  ])
  let unregister = (): void => {}
  await NativeSessionLog.resolve({ enabled: true })({
    scope,
    require: (key: string) => services.get(key),
    effect: (dispose: () => void) => { unregister = dispose },
  } as never)
  if (provider === undefined) throw new Error('Native Session-log provider was not registered')

  return {
    session,
    first,
    events,
    get durableEvents() { return durableEvents },
    owner,
    provider,
    readStarted: readStarted.promise,
    releaseRead: () => { releaseRead.resolve(undefined) },
    flushStarted: flushStarted.promise,
    releaseFlush: () => { releaseFlush.resolve(undefined) },
    unregister: () => { unregister() },
    isRegistered: () => registered,
    setCurrentOwner: (next: NativeActiveSessionOwner | undefined) => { currentOwner = next },
  }
}

function request(sessionId: SessionId): DeepSeekLlmApiExtensionRequest {
  return { body: { messages: [] }, sessionId: String(sessionId), signal: new AbortController().signal }
}

it('accepts the captured durable suffix through the same owner after contribution removal', async () => {
  expect(() => NativeSessionLog.resolve(null)).toThrow(/configuration must be an object/)
  expect(() => NativeSessionLog.resolve({ unknown: true })).toThrow(/unknown native configuration field/)

  const harness = await nativeHarness()
  const preparing = harness.provider.prepare(request(harness.session.id))
  const captured = await harness.readStarted
  const later = harness.session.append('step/start', { turn: 1, step: 1 })
  harness.events.push(later)
  harness.releaseRead()
  const prepared = await preparing
  if (prepared === undefined || prepared.accept === undefined) throw new Error('Native Session-log upload was not prepared')

  expect(captured).toEqual([harness.first])
  expect(prepared.value.throughSeq).toBe(Number(harness.first.seq))
  expect(prepared.value.events.map(event => event.seq)).toEqual([Number(harness.first.seq)])
  expect(Number(later.seq)).toBeGreaterThan(prepared.value.throughSeq)

  harness.unregister()
  expect(harness.isRegistered()).toBe(false)
  let accepted = false
  const acceptance = Promise.resolve(prepared.accept()).then(() => { accepted = true })
  const flushed = await harness.flushStarted
  const marker = flushed.at(-1)
  expect(marker).toMatchObject({
    type: 'session-log-deepseek/delivery-accepted',
    data: { sessionId: harness.session.id, throughSeq: harness.first.seq },
  })
  expect(accepted).toBe(false)
  expect(harness.durableEvents).toEqual([harness.first])

  harness.releaseFlush()
  await acceptance
  expect(accepted).toBe(true)
  expect(harness.durableEvents).toEqual(flushed)
  expect(harness.durableEvents.at(-1)).toBe(marker)
})

it.each([
  { name: 'revoked owner', replacement: false },
  { name: 'same-id replacement owner', replacement: true },
])('does not write acceptance through a $name', async ({ replacement }) => {
  const harness = await nativeHarness()
  const preparing = harness.provider.prepare(request(harness.session.id))
  await harness.readStarted
  harness.releaseRead()
  const prepared = await preparing
  if (prepared === undefined || prepared.accept === undefined) throw new Error('Native Session-log upload was not prepared')

  const replacementEvents: SessionEvent[] = []
  if (replacement) {
    const successorSession = Session.create(harness.session.id, undefined, {
      id: harness.session.id, version: SESSION_FORMAT_VERSION, createdAt: 0, isSeeded: false,
    })
    const successor = {
      ...harness.owner,
      agent: { scope: new NativeScope() },
      session: successorSession,
      append(type: string, data: unknown) {
        const event = successorSession.append(type as 'session-log-deepseek/delivery-accepted', data as never)
        replacementEvents.push(event)
        return event
      },
    } as unknown as NativeActiveSessionOwner
    harness.setCurrentOwner(successor)
    expect(String(successor.session.id)).toBe(String(harness.session.id))
  } else {
    harness.setCurrentOwner(undefined)
  }

  await expect(prepared.accept()).rejects.toThrow(/exact active Session owner is no longer writable/)
  expect(harness.events).toEqual([harness.first])
  expect(harness.durableEvents).toEqual([harness.first])
  expect(replacementEvents).toEqual([])
})

it('propagates the captured owner flush failure after appending the acceptance marker', async () => {
  const failure = new Error('fixture flush failed')
  const harness = await nativeHarness(failure)
  const preparing = harness.provider.prepare(request(harness.session.id))
  await harness.readStarted
  harness.releaseRead()
  const prepared = await preparing
  if (prepared === undefined || prepared.accept === undefined) throw new Error('Native Session-log upload was not prepared')

  await expect(prepared.accept()).rejects.toBe(failure)
  expect(harness.events.at(-1)).toMatchObject({ type: 'session-log-deepseek/delivery-accepted' })
  expect(harness.durableEvents).toEqual([harness.first])
})
