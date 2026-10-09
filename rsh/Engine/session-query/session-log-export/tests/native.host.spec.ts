/** Native Host archive installation, exact-owner flush, and provider shutdown. */
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin, type NativeServices } from '@deepseek-ai/dsh-native-runtime'
import { createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { plugin as headlessPlugin } from '@deepseek-ai/dsh-native-headless/native'
import { plugin as localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as nativeAgentPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as modelExecutionPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as sessionExecutionPlugin } from '@deepseek-ai/dsh-native-session-execution/native'
import { plugin as jsonlPersistencePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { plugin as sessionQueryPlugin } from '@deepseek-ai/dsh-session-query/native'
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution/active-session-protocol'
import { SESSION_FORMAT_VERSION, Session, SessionId, SessionLogOffset, SessionSeq, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session/native'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence/native'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence/native'
import { strFromU8, unzipSync } from 'fflate'
import { SESSION_LOG_FILENAME } from '../src/archive.ts'
import { plugin as archivePlugin, type NativeSessionLogExportOperations } from '../src/native.ts'

const id = (value: string): SessionId => SessionId(value)
const turnStart: SessionEvent = { type: 'turn/start', seq: SessionSeq(0), time: 1000, data: { turn: 1 } }

function attachmentEvent(kind: 'image' | 'file'): SessionEvent {
  const attachment = kind === 'image'
    ? { attachmentId: 'native-image', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }
    : { attachmentId: 'native-file', name: 'notes.txt', bytes: 1 }
  return {
    type: 'user/message', seq: SessionSeq(1), time: 1001,
    data: { content: [{ type: kind, attachment }] },
  } as unknown as SessionEvent
}

function header(sessionId: SessionId, parentSession?: SessionId): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: sessionId,
    createdAt: 500,
    isSeeded: false,
    ...parentSession === undefined ? {} : { parentSession },
    delegationDepth: parentSession === undefined ? 0 : 1,
  }
}

function readHandle(sessionHeader: SessionHeader, events: readonly SessionEvent[], onClose = vi.fn(async () => {})) {
  return {
    header: sessionHeader,
    read: vi.fn(async () => ({ events })),
    close: onClose,
  } as unknown as SessionHandle
}

function activeOwner(sessionId: SessionId, flush: () => Promise<void>): NativeActiveSessionOwner {
  return {
    agent: {},
    session: { id: sessionId },
    writerAvailable: true,
    flush,
  } as unknown as NativeActiveSessionOwner
}

function provider<K extends keyof NativeServices>(
  name: string,
  serviceName: K,
  service: NativeServices[K],
): NativePlugin {
  return {
    apiVersion: 1,
    name,
    targets: ['host'],
    requires: [],
    provides: [serviceName],
    resolve: () => (context) => { context.provide(serviceName, service) },
  }
}

/** Other query protocol operations are intentionally unimplemented; archive fixtures exercise only `traceSession`. */
function archiveQueryDouble(
  operations: Pick<NativeServices['sessionQuery'], 'traceSession'>,
): NativeServices['sessionQuery'] {
  return operations as unknown as NativeServices['sessionQuery']
}

/** Other persistence protocol operations are intentionally unimplemented; these fixtures exercise only `open`. */
function archivePersistenceDouble(
  operations: Pick<NativeServices['sessionPersistence'], 'open'>,
): NativeServices['sessionPersistence'] {
  return operations as unknown as NativeServices['sessionPersistence']
}

/** Other attachment protocol operations are intentionally unimplemented; archive fixtures exercise only these readers. */
function archiveAttachmentDouble(
  operations: Pick<NativeServices['attachments'], 'readImage' | 'readFileStream'>,
): NativeServices['attachments'] {
  return operations as unknown as NativeServices['attachments']
}

async function install(
  logs: ReadonlyMap<SessionId, SessionHandle>,
  query: NativeServices['sessionQuery'],
  active: NativeServices['activeSessions'],
  persistenceOverride?: NativeServices['sessionPersistence'],
  attachmentsOverride?: NativeServices['attachments'],
  archiveConfig?: unknown,
) {
  let exportService: NativeSessionLogExportOperations | undefined
  const capture: NativePlugin = {
    apiVersion: 1,
    name: 'session-log-export-test-consumer',
    targets: ['host'],
    requires: ['sessionLogExport'],
    provides: [],
    resolve: () => (context) => { exportService = context.require('sessionLogExport') },
  }
  const persistence = persistenceOverride ?? {
    open: async (sessionId: SessionId) => {
      const handle = logs.get(sessionId)
      if (handle === undefined) throw new SessionPersistenceNotFoundError(sessionId)
      return handle
    },
  }
  const attachments = attachmentsOverride ?? {
    readImage: async () => { throw new Error('fixture has no images') },
    readFileStream: async function* () { throw new Error('fixture has no files') },
  }
  const scope = new NativeScope()
  const host = new NativeHost(resolveInstallation([
    { plugin: provider('session-log-export-test-query', 'sessionQuery', query), scope, config: undefined },
    { plugin: provider('session-log-export-test-persistence', 'sessionPersistence', archivePersistenceDouble(persistence)), scope, config: undefined },
    { plugin: provider('session-log-export-test-attachments', 'attachments', archiveAttachmentDouble(attachments)), scope, config: undefined },
    { plugin: provider('session-log-export-test-active-sessions', 'activeSessions', active), scope, config: undefined },
    { plugin: archivePlugin, scope, config: archiveConfig },
    { plugin: capture, scope, config: undefined },
  ], 'host'))
  await host.start()
  if (exportService === undefined) throw new Error('Native consumer did not receive sessionLogExport')
  return { host, exportService }
}

function activeRegistry(owners: () => readonly NativeActiveSessionOwner[]): NativeServices['activeSessions'] {
  return {
    owners,
    owner: (agent, session) => owners().find(value => value.agent === agent && value.session === session),
  } as NativeServices['activeSessions']
}

function closeArchiveProvider(service: NativeSessionLogExportOperations): Promise<void> {
  return (service as NativeSessionLogExportOperations & { close(): Promise<void> }).close()
}

function observeArchiveProviderClose(service: NativeSessionLogExportOperations) {
  const entered: PromiseWithResolvers<void> = Promise.withResolvers()
  let settled = false
  const closable = service as NativeSessionLogExportOperations & { close(): Promise<void> }
  const close = closable.close.bind(closable)
  vi.spyOn(closable, 'close').mockImplementation(() => {
    const completion = close()
    void completion.then(() => { settled = true }, () => { settled = true })
    entered.resolve()
    return completion
  })
  return { entered: entered.promise, isSettled: () => settled }
}

class GatedKeylessAdapter extends LlmAdapter {
  readonly entered: PromiseWithResolvers<void> = Promise.withResolvers()
  readonly release: PromiseWithResolvers<void> = Promise.withResolvers()

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const text = 'native archive fixture'
    this.entered.resolve()
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    await this.release.promise
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: text.length } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

it('installs a Native consumer and exports root and descendant canonical logs after each live owner flushes', async () => {
  const rootId = id('native-root')
  const childId = id('native-child')
  const order: string[] = []
  const rootOwner = activeOwner(rootId, async () => { order.push('flush:root') })
  const childOwner = activeOwner(childId, async () => { order.push('flush:child') })
  const handles = new Map([
    [rootId, readHandle(header(rootId), [turnStart])],
    [childId, readHandle(header(childId, rootId), [turnStart])],
  ])
  const query = archiveQueryDouble({
    traceSession: async () => ({
      target: { header: header(rootId), live: true, persisted: true },
      ancestors: [],
      complete: true,
      root: { header: header(rootId), live: true, persisted: true },
      descendants: [{
        session: { header: header(childId, rootId), live: true, persisted: true },
        descendants: [],
      }],
    }),
  })
  const active = activeRegistry(() => [rootOwner, childOwner])
  const persistence = archivePersistenceDouble({
    open: async (sessionId: SessionId) => {
      order.push(`open:${sessionId}`)
      const handle = handles.get(sessionId)
      if (handle === undefined) throw new SessionPersistenceNotFoundError(sessionId)
      return handle
    },
  })
  const configured = await install(
    handles,
    query,
    active,
    persistence,
    undefined,
    { compressionLevel: 0 },
  )
  try {
    const archive = await configured.exportService.createArchive(rootId, { includeDescendants: true })
    if (archive === undefined) throw new Error('missing root archive')
    expect(archive.filename).toBe('dsh-session-native-root.zip')
    const files = unzipSync(new Uint8Array(await new Response(archive.stream).arrayBuffer()))
    expect(Object.keys(files)).toEqual(['session.v3.jsonl', 'subagents/native-child/session.v3.jsonl'])
    expect(strFromU8(files['session.v3.jsonl'] as Uint8Array)).toContain('"type":"session"')
    expect(order).toEqual([
      'flush:root', 'open:native-root',
      'flush:child', 'open:native-child',
    ])
  } finally {
    await configured.host.stop()
  }
})

it('exports live Native sole-writer JSONL and a seeded persisted descendant', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-native-archive-'))
  const workspace = join(directory, 'work')
  const sessions = join(directory, 'sessions')
  await mkdir(workspace, { recursive: true })
  const scope = new NativeScope()
  const adapter = new GatedKeylessAdapter()
  const rootId = id('native-archive-root')
  let application: NativeHeadlessApplication | undefined
  let exportService: NativeSessionLogExportOperations | undefined
  let persistence: NativeServices['sessionPersistence'] | undefined
  let active: NativeServices['activeSessions'] | undefined
  let host: NativeHost | undefined
  let turn: Promise<unknown> | undefined
  let restoreOwnerFlush: (() => void) | undefined

  const capture: NativePlugin = {
    apiVersion: 1,
    name: 'session-log-export-native-producer-capture',
    targets: ['host'],
    requires: ['application', 'sessionLogExport', 'sessionPersistence', 'activeSessions'],
    provides: [],
    resolve: () => (context) => {
      const selected = context.require('application')
      if (!(selected instanceof NativeHeadlessApplication)) throw new Error('Native headless application is missing')
      application = selected
      exportService = context.require('sessionLogExport')
      persistence = context.require('sessionPersistence')
      active = context.require('activeSessions')
    },
  }
  const modelProvider = provider('session-log-export-keyless-model', 'model', adapter)
  const attachmentProvider = provider('session-log-export-empty-attachments', 'attachments', archiveAttachmentDouble({
    readImage: async () => { throw new Error('unexpected image read') },
    readFileStream: async function* () { throw new Error('unexpected file read') },
  }))

  try {
    host = new NativeHost(resolveInstallation([
      { plugin: capture, scope, config: undefined },
      { plugin: headlessPlugin, scope, config: {
        cwd: workspace, provider: 'fixture', model: 'keyless', systemPrompt: 'Answer directly.', maxSteps: 1, builtinTools: false,
      } },
      { plugin: nativeAgentPlugin, scope, config: undefined },
      { plugin: sessionExecutionPlugin, scope, config: undefined },
      { plugin: modelExecutionPlugin, scope, config: undefined },
      { plugin: modelProvider, scope, config: undefined },
      { plugin: localFilesystemPlugin, scope, config: { cwd: workspace } },
      { plugin: jsonlPersistencePlugin, scope, config: { root: sessions, compression: 'none' } },
      { plugin: sessionQueryPlugin, scope, config: {} },
      { plugin: attachmentProvider, scope, config: undefined },
      { plugin: archivePlugin, scope, config: { compressionLevel: 0 } },
    ], 'host'))
    await host.start()
    if (application === undefined || exportService === undefined || persistence === undefined || active === undefined) {
      throw new Error('Native archive producer installation is incomplete')
    }

    turn = application.executeRootTurn({
      id: rootId,
      resume: false,
      message: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Export this live Session.' }] }),
    }, new AbortController().signal)
    await adapter.entered.promise
    const owner = active.owners().find(candidate => candidate.session.id === rootId)
    if (owner === undefined) throw new Error('Native headless did not publish its live sole writer')
    const ownerFlush = vi.spyOn(owner, 'flush')
    restoreOwnerFlush = () => { ownerFlush.mockRestore() }

    const initial = await exportService.createArchive(rootId, { includeDescendants: false })
    if (initial === undefined) throw new Error('Native persistence did not expose the live root log')
    const initialFiles = unzipSync(new Uint8Array(await new Response(initial.stream).arrayBuffer()))
    const initialText = strFromU8(initialFiles[SESSION_LOG_FILENAME] as Uint8Array)
    expect(initialText).toContain('"type":"session"')
    expect(initialText).toContain('"type":"turn/start"')
    expect(ownerFlush).toHaveBeenCalledTimes(1)

    const rootReader = await persistence.open(rootId, 'read')
    let rootEvents: readonly SessionEvent[]
    let rootHeader: SessionHeader
    try {
      rootEvents = (await rootReader.read()).events
      rootHeader = rootReader.header
    } finally {
      await rootReader.close()
    }

    const childId = id('native-archive-child')
    const child = Session.create(childId, rootEvents, {
      ...rootHeader,
      id: childId,
      createdAt: rootHeader.createdAt + 1,
      parentSession: rootId,
      origin: 'subagent',
      isSeeded: true,
      delegationDepth: 1,
    }, SessionLogOffset(rootEvents.length))
    const childWriter = await persistence.create(child.header, { inheritedEventCount: child.inheritedEventCount })
    try {
      await childWriter.append(child.snapshotEvents())
      await childWriter.flush()
    } finally {
      await childWriter.close()
    }

    const archive = await exportService.createArchive(rootId, { includeDescendants: true })
    if (archive === undefined) throw new Error('Native persistence lost the live root log')
    const files = unzipSync(new Uint8Array(await new Response(archive.stream).arrayBuffer()))
    const childPath = `subagents/native-archive-child/${SESSION_LOG_FILENAME}`
    expect(Object.keys(files)).toEqual([SESSION_LOG_FILENAME, childPath])
    expect(ownerFlush).toHaveBeenCalledTimes(2)
    const rootText = strFromU8(files[SESSION_LOG_FILENAME] as Uint8Array)
    const childText = strFromU8(files[childPath] as Uint8Array)
    const rootHeaderLine = rootText.split('\n')[0]
    const childHeaderLine = childText.split('\n')[0]
    if (rootHeaderLine === undefined || childHeaderLine === undefined) throw new Error('Native ZIP contains an empty JSONL log')
    expect(JSON.parse(rootHeaderLine)).toMatchObject({ type: 'session', version: SESSION_FORMAT_VERSION, id: rootId })
    expect(rootText).toContain('"type":"turn/start"')
    expect(JSON.parse(childHeaderLine)).toMatchObject({
      type: 'session', version: SESSION_FORMAT_VERSION, id: childId, parentSession: rootId,
      isSeeded: true, delegationDepth: 1,
    })
    expect(childText).toContain('"type":"session/end-seed"')
    expect(childText).toContain('"inherited":true')
  } finally {
    adapter.release.resolve()
    await turn?.catch(() => undefined)
    restoreOwnerFlush?.()
    await host?.stop()
    await rm(directory, { recursive: true, force: true })
  }
})

it.each([
  ['null', null],
  ['array', []],
  ['primitive', 'invalid'],
  ['unknown field', { unknown: true }],
  ['non-number level', { compressionLevel: '6' }],
  ['fractional level', { compressionLevel: 1.5 }],
  ['negative level', { compressionLevel: -1 }],
  ['high level', { compressionLevel: 10 }],
] as const)('rejects invalid Native archive configuration: %s', (_name, config) => {
  expect(() => archivePlugin.resolve(config)).toThrow()
})

it.each([
  ['default level', undefined],
  ['omitted level', {}],
  ['maximum level', { compressionLevel: 9 }],
] as const)('accepts valid Native archive configuration: %s', (_name, config) => {
  expect(() => archivePlugin.resolve(config)).not.toThrow()
})

it('cannot resolve the Native archive without its required Host providers', () => {
  const scope = new NativeScope()
  expect(() => resolveInstallation([
    { plugin: archivePlugin, scope, config: undefined },
  ], 'host')).toThrow()
})

it('returns undefined when canonical persistence has no root log', async () => {
  const sessionId = id('missing-root')
  const configured = await install(
    new Map(),
    archiveQueryDouble({ traceSession: async () => { throw new Error('unused') } }),
    activeRegistry(() => []),
  )
  try {
    await expect(configured.exportService.createArchive(sessionId, { includeDescendants: false })).resolves.toBeUndefined()
  } finally {
    await configured.host.stop()
  }
})

it.each([
  { phase: 'flush', expected: 'active owner changed while flushing', opens: 0 },
  { phase: 'read', expected: 'active owner changed while reading', opens: 1 },
] as const)('rejects a same-id owner replacement during $phase', async ({ phase, expected, opens }) => {
  const sessionId = id(`replaced-owner-${phase}`)
  let current: NativeActiveSessionOwner
  current = activeOwner(sessionId, async () => {
    if (phase === 'flush') current = activeOwner(sessionId, async () => {})
  })
  const open = vi.fn(async () => {
    if (phase === 'read') current = activeOwner(sessionId, async () => {})
    return readHandle(header(sessionId), [turnStart])
  })
  const configured = await install(
    new Map([[sessionId, readHandle(header(sessionId), [turnStart])]]),
    archiveQueryDouble({ traceSession: async () => { throw new Error('unused') } }),
    activeRegistry(() => [current]),
    archivePersistenceDouble({ open }),
  )
  try {
    await expect(configured.exportService.createArchive(sessionId, { includeDescendants: false }))
      .rejects.toThrow(expected)
    expect(open).toHaveBeenCalledTimes(opens)
  } finally {
    await configured.host.stop()
  }
})

it('rejects multiple active owners before reading and rejects a new owner during a cold read', async () => {
  const sessionId = id('multiple-active-owner')
  const first = activeOwner(sessionId, async () => {})
  const second = activeOwner(sessionId, async () => {})
  const multipleOpen = vi.fn(async () => readHandle(header(sessionId), [turnStart]))
  const multiple = await install(
    new Map(),
    archiveQueryDouble({ traceSession: async () => { throw new Error('unused') } }),
    activeRegistry(() => [first, second]),
    archivePersistenceDouble({ open: multipleOpen }),
  )
  try {
    await expect(multiple.exportService.createArchive(sessionId, { includeDescendants: false }))
      .rejects.toThrow('multiple active owners')
    expect(multipleOpen).not.toHaveBeenCalled()
  } finally {
    await multiple.host.stop()
  }

  let owners: readonly NativeActiveSessionOwner[] = []
  const appeared = activeOwner(sessionId, async () => {})
  const coldOpen = vi.fn(async () => {
    owners = [appeared]
    return readHandle(header(sessionId), [turnStart])
  })
  const cold = await install(
    new Map(),
    archiveQueryDouble({ traceSession: async () => { throw new Error('unused') } }),
    activeRegistry(() => owners),
    archivePersistenceDouble({ open: coldOpen }),
  )
  try {
    await expect(cold.exportService.createArchive(sessionId, { includeDescendants: false }))
      .rejects.toThrow('active owner changed while reading')
    expect(coldOpen).toHaveBeenCalledOnce()
  } finally {
    await cold.host.stop()
  }
})

it('checks request cancellation after the exact active owner flushes and before opening persistence', async () => {
  const sessionId = id('abort-during-flush')
  const gate: PromiseWithResolvers<void> = Promise.withResolvers()
  const started: PromiseWithResolvers<void> = Promise.withResolvers()
  const owner = activeOwner(sessionId, async () => { started.resolve(); await gate.promise })
  const open = vi.fn(async () => readHandle(header(sessionId), [turnStart]))
  const configured = await install(
    new Map(),
    archiveQueryDouble({ traceSession: async () => { throw new Error('unused') } }),
    activeRegistry(() => [owner]),
    archivePersistenceDouble({ open }),
  )
  try {
    const controller = new AbortController()
    const reason = new Error('request cancelled while flushing')
    const request = configured.exportService.createArchive(sessionId, { includeDescendants: false, signal: controller.signal })
    await started.promise
    controller.abort(reason)
    gate.resolve()
    await expect(request).rejects.toBe(reason)
    expect(open).not.toHaveBeenCalled()
  } finally {
    gate.resolve()
    await configured.host.stop()
  }
})

it.each(['lineage', 'open', 'read', 'close'] as const)(
  'Native Host disposal drains delayed descendant %s work and its handle',
  async (phase) => {
    const rootId = id(`drain-root-${phase}`)
    const childId = id(`drain-child-${phase}`)
    const gate: PromiseWithResolvers<void> = Promise.withResolvers()
    const started: PromiseWithResolvers<void> = Promise.withResolvers()
    let heldSignal: AbortSignal | undefined
    const rootHandle = readHandle(header(rootId), [turnStart])
    const closeChildHandle = vi.fn(async () => {
      if (phase === 'close') {
        started.resolve()
        await gate.promise
      }
    })
    const childHandle = {
      header: header(childId, rootId),
      read: vi.fn(async (_offset?: number, _length?: number, options?: { signal?: AbortSignal }) => {
        if (phase === 'read') {
          heldSignal = options?.signal
          started.resolve()
          await gate.promise
        }
        return { events: [turnStart] }
      }),
      close: closeChildHandle,
    } as unknown as SessionHandle
    const query = archiveQueryDouble({
      traceSession: async (_id: SessionId, signal?: AbortSignal) => {
        if (phase === 'lineage') {
          heldSignal = signal
          started.resolve()
          await gate.promise
        }
        return {
          target: { header: header(rootId), live: true, persisted: true },
          ancestors: [],
          complete: true,
          root: { header: header(rootId), live: true, persisted: true },
          descendants: [{ session: { header: header(childId, rootId), live: true, persisted: true }, descendants: [] }],
        }
      },
    })
    const persistence = archivePersistenceDouble({
      open: async (sessionId: SessionId, _access: 'read' | 'write', options?: { signal?: AbortSignal }) => {
        if (sessionId === rootId) return rootHandle
        if (phase === 'open') {
          heldSignal = options?.signal
          started.resolve()
          await gate.promise
        }
        return childHandle
      },
    })
    const configured = await install(
      new Map([[rootId, rootHandle]]),
      query,
      activeRegistry(() => []),
      persistence,
    )
    try {
      const archive = await configured.exportService.createArchive(rootId, { includeDescendants: true })
      if (archive === undefined) throw new Error('missing root archive')
      await started.promise
      const close = observeArchiveProviderClose(configured.exportService)
      let stopped = false
      const stopping = configured.host.stop().then(() => { stopped = true })
      await close.entered
      await new Promise<void>(resolve => setImmediate(resolve))
      if (phase !== 'close') expect(heldSignal?.aborted).toBe(true)
      expect(close.isSettled()).toBe(false)
      expect(stopped).toBe(false)
      gate.resolve()
      await stopping
      expect(stopped).toBe(true)
      if (phase === 'lineage') expect(closeChildHandle).not.toHaveBeenCalled()
      else expect(closeChildHandle).toHaveBeenCalledOnce()
    } finally {
      gate.resolve()
      await configured.host.stop()
    }
  },
)

it.each([
  { attachment: 'image', cancellation: 'request' },
  { attachment: 'image', cancellation: 'consumer' },
  { attachment: 'file', cancellation: 'request' },
  { attachment: 'file', cancellation: 'consumer' },
] as const)('drains abort-ignoring $attachment work after $cancellation cancellation', async ({ attachment, cancellation }) => {
  const sessionId = id(`attachment-drain-${attachment}-${cancellation}`)
  const gate: PromiseWithResolvers<void> = Promise.withResolvers()
  const started: PromiseWithResolvers<void> = Promise.withResolvers()
  const iteratorReturned = vi.fn(async () => ({ done: true as const, value: undefined }))
  let heldSignal: AbortSignal | undefined
  const attachmentOperations = attachment === 'image'
    ? {
      readImage: async (ref: ImageAttachmentRef, signal?: AbortSignal) => {
        heldSignal = signal
        started.resolve()
        await gate.promise
        return { ref, data: new Uint8Array([1, 2, 3]) }
      },
      readFileStream: async function* () { throw new Error('fixture has no files') },
    }
    : {
      readImage: async () => { throw new Error('fixture has no images') },
      readFileStream: (_ref: unknown, signal?: AbortSignal) => ({
        [Symbol.asyncIterator]() {
          let yielded = false
          return {
            async next() {
              heldSignal = signal
              started.resolve()
              await gate.promise
              if (yielded) return { done: true as const, value: undefined }
              yielded = true
              return { done: false as const, value: new Uint8Array([1, 2, 3]) }
            },
            return: iteratorReturned,
          }
        },
      }),
    }
  const configured = await install(
    new Map([[sessionId, readHandle(header(sessionId), [turnStart, attachmentEvent(attachment)])]]),
    archiveQueryDouble({ traceSession: async () => { throw new Error('unused') } }),
    activeRegistry(() => []),
    undefined,
    archiveAttachmentDouble(attachmentOperations),
  )
  try {
    const controller = new AbortController()
    const archive = await configured.exportService.createArchive(sessionId, {
      includeDescendants: false,
      ...(cancellation === 'request' ? { signal: controller.signal } : {}),
    })
    if (archive === undefined) throw new Error('missing root archive')
    const reader = cancellation === 'consumer' ? archive.stream.getReader() : undefined
    await started.promise
    const reason = new Error(`${cancellation} left during attachment read`)
    if (cancellation === 'request') controller.abort(reason)
    else await reader?.cancel(reason)
    const close = observeArchiveProviderClose(configured.exportService)
    let stopped = false
    const stopping = configured.host.stop().then(() => { stopped = true })
    await close.entered
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(heldSignal?.aborted).toBe(true)
    expect(close.isSettled()).toBe(false)
    expect(stopped).toBe(false)
    gate.resolve()
    await stopping
    expect(stopped).toBe(true)
    if (attachment === 'file') expect(iteratorReturned).toHaveBeenCalledOnce()
  } finally {
    gate.resolve()
    await configured.host.stop()
  }
})

it('stops an unpulled ZIP producer during Native provider disposal', async () => {
  const sessionId = id('unpulled-stream')
  const payload = randomBytes(350_000).toString('base64')
  const event = { ...turnStart, data: { turn: 1, payload } } as unknown as SessionEvent
  const configured = await install(
    new Map([[sessionId, readHandle(header(sessionId), [event])]]),
    archiveQueryDouble({ traceSession: async () => { throw new Error('unused') } }),
    activeRegistry(() => []),
  )
  const archive = await configured.exportService.createArchive(sessionId, { includeDescendants: false })
  try {
    if (archive === undefined) throw new Error('missing root archive')
    let timeout: ReturnType<typeof setTimeout> | undefined
    const close = closeArchiveProvider(configured.exportService)
    expect(closeArchiveProvider(configured.exportService)).toBe(close)
    await expect(configured.exportService.createArchive(sessionId, { includeDescendants: false }))
      .rejects.toThrow('provider is closing')
    const stopResult = await Promise.race([
      close.then(() => 'stopped' as const),
      new Promise<'timeout'>((resolve) => { timeout = setTimeout(() => { resolve('timeout') }, 2000) }),
    ])
    if (timeout !== undefined) clearTimeout(timeout)
    expect(stopResult).toBe('stopped')
    const consume = async (): Promise<void> => {
      const reader = archive.stream.getReader()
      while (!(await reader.read()).done) {}
    }
    await expect(consume()).rejects.toThrow()
  } finally {
    await configured.host.stop()
  }
})

it('waits for late open, read, and handle close during Native provider disposal', async () => {
  const sessionId = id('late-open')
  let releaseOpen: ((handle: SessionHandle) => void) | undefined
  let openStarted: (() => void) | undefined
  let releaseRead: ((result: { events: readonly SessionEvent[] }) => void) | undefined
  let readStarted: (() => void) | undefined
  const started = new Promise<void>((resolve) => { openStarted = resolve })
  const reading = new Promise<void>((resolve) => { readStarted = resolve })
  const closed = vi.fn(async () => {})
  let openSignal: AbortSignal | undefined
  let readSignal: AbortSignal | undefined
  const handle = {
    header: header(sessionId),
    read: vi.fn((_offset?: number, _length?: number, options?: { signal?: AbortSignal }) => {
      readSignal = options?.signal
      readStarted?.()
      return new Promise<{ events: readonly SessionEvent[] }>((resolve) => { releaseRead = resolve })
    }),
    close: closed,
  } as unknown as SessionHandle
  const persistence = archivePersistenceDouble({
    open: async (_id: SessionId, _access: 'read' | 'write', options?: { signal?: AbortSignal }) => {
      openSignal = options?.signal
      openStarted?.()
      return new Promise<SessionHandle>((resolve) => { releaseOpen = resolve })
    },
  })
  const configured = await install(
    new Map([[sessionId, handle]]),
    archiveQueryDouble({ traceSession: async () => { throw new Error('unused') } }),
    activeRegistry(() => []),
    persistence,
  )
  const accepted = configured.exportService.createArchive(sessionId, { includeDescendants: false })
  const acceptedResult = accepted.then(() => undefined, (error: unknown) => error)
  try {
    await started
    let stopped = false
    const stopping = configured.host.stop().then(() => { stopped = true })
    expect(openSignal?.aborted).toBe(true)
    expect(stopped).toBe(false)
    releaseOpen?.(handle)
    await reading
    expect(readSignal?.aborted).toBe(true)
    expect(stopped).toBe(false)
    releaseRead?.({ events: [turnStart] })
    expect(await acceptedResult).toBeInstanceOf(Error)
    await stopping
    expect(closed).toHaveBeenCalledOnce()
  } finally {
    releaseOpen?.(handle)
    releaseRead?.({ events: [turnStart] })
    await configured.host.stop()
  }
})
