/**
 * `@`-mention search: Provider delegation, the optional-Provider downgrade, and
 * the workspace boundary the reporting Host must never cross.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { LocalFileSystemBackend, resolveLocalFilesystemConfig } from '@redspark/rsh-fs-local/backend'
import type { NativeHeadlessApplication } from '@redspark/rsh-native-headless/native'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from '@redspark/rsh-native-session-execution'
import type { NativeSessionPersistenceOperations } from '@redspark/rsh-session-persistence/native'
import { SESSION_FORMAT_VERSION, SessionId } from '@redspark/rsh-session/native'
import type { ConnectionRpcResult } from '@redspark/rsh-client-connection/native-host'
import type { NativeFileReferenceOperations } from '@redspark/rsh-file-reference/native'
import type { FileReferenceCandidate } from '@redspark/rsh-file-reference/types'
import { NativeWebSessionService, resolveNativeWebSessionConfig,
  type NativeWebSelectionProviders } from '../src/native.ts'

const CONFIG = (cwd: string) => resolveNativeWebSessionConfig({
  cwd, provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.', maxSteps: 1, builtinTools: false,
  maxPendingRequests: 1, maxHistoryEvents: 10, maxPromptChars: 100,
  maxFollowBufferBytes: 1024, maxFollowers: 2, maxPendingHumanRequests: 1,
})

/** One attached root owner over a workspace, plus the managers the service reads. */
function serviceFor(workspace: string, id: ReturnType<typeof SessionId>, fs: LocalFileSystemBackend,
  fileReferences?: NativeFileReferenceOperations): {
  readonly service: NativeWebSessionService
  readonly owner: NativeActiveSessionOwner
} {
  const header = { id, version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false, cwd: workspace }
  const owner = {
    agent: { scope: {} }, session: { id, header }, invocation: 'root', writerAvailable: true,
    onEvent: () => () => {},
  } as unknown as NativeActiveSessionOwner
  const persistence = { stat: async () => ({ header }) } as unknown as NativeSessionPersistenceOperations
  const active = {
    owners: () => [owner],
    owner: (agent: unknown, session: unknown) => (owner.agent === agent && owner.session === session ? owner : undefined),
    onAttached: () => async () => {},
    onDetached: () => async () => {},
  } as unknown as NativeActiveSessionOperations
  const service = new NativeWebSessionService(
    { dispose: async () => undefined } as unknown as NativeHeadlessApplication,
    persistence,
    active,
    CONFIG(workspace),
    new AbortController().signal,
    fileReferences === undefined ? {} : { fileReferences } satisfies NativeWebSelectionProviders,
    undefined,
    fs,
  )
  return { service, owner }
}

async function value(result: Promise<ConnectionRpcResult<unknown>>): Promise<unknown> {
  const reply = await result
  if (!reply.ok) throw new Error(reply.error.message)
  return reply.value
}

it('returns an empty candidate list when the Host installs no file-reference Provider', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-search-absent-'))
  const workspace = join(temp, 'workspace')
  await mkdir(workspace)
  await writeFile(join(workspace, 'notes.txt'), 'first\n')
  const id = SessionId('search-absent')
  const fs = new LocalFileSystemBackend(resolveLocalFilesystemConfig({ cwd: workspace }))
  const { service } = serviceFor(workspace, id, fs)
  try {
    // The Provider is optional, so the endpoint must still answer rather than fail.
    await expect(value(service.handle('session/files/search', { sessionId: id, query: '' },
      new AbortController().signal))).resolves.toEqual({ candidates: [] })
    await expect(value(service.handle('session/files/search', { sessionId: id, query: 'notes' },
      new AbortController().signal))).resolves.toEqual({ candidates: [] })
  } finally {
    await service.close()
  }
})

it('delegates the query to the exact root owner and forwards only path and kind', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-search-passthrough-'))
  const workspace = join(temp, 'workspace')
  await mkdir(workspace)
  const id = SessionId('search-passthrough')
  const fs = new LocalFileSystemBackend(resolveLocalFilesystemConfig({ cwd: workspace }))
  const candidates: FileReferenceCandidate[] = [
    { path: 'src/main.ts', kind: 'file' },
    { path: 'src', kind: 'directory' },
  ]
  const list = vi.fn(async (_agent: unknown, _session: unknown, _query: string, _signal: AbortSignal) => candidates)
  const fileReferences = { list } as unknown as NativeFileReferenceOperations
  const { service, owner } = serviceFor(workspace, id, fs, fileReferences)
  try {
    await expect(value(service.handle('session/files/search',
      { sessionId: id, query: 'src' }, new AbortController().signal))).resolves.toEqual({
      candidates: [
        { path: 'src/main.ts', kind: 'file' },
        { path: 'src', kind: 'directory' },
      ],
    })
    // Ranking belongs to the Provider: this layer must not re-sort or truncate.
    expect(list).toHaveBeenCalledTimes(1)
    expect(list.mock.calls[0]?.[0]).toBe(owner.agent)
    expect(list.mock.calls[0]?.[1]).toBe(owner.session)
    expect(list.mock.calls[0]?.[2]).toBe('src')
  } finally {
    await service.close()
  }
})

it('refuses to search when the Session has no attached root owner', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-search-detached-'))
  const workspace = join(temp, 'workspace')
  await mkdir(workspace)
  const id = SessionId('search-detached')
  const fs = new LocalFileSystemBackend(resolveLocalFilesystemConfig({ cwd: workspace }))
  const list = vi.fn(async () => [] as FileReferenceCandidate[])
  const { service } = serviceFor(workspace, id, fs, { list } as unknown as NativeFileReferenceOperations)
  try {
    // Search a Session id the attached owner does not hold: the endpoint reports a
    // business failure rather than answering from another Session's workspace.
    const other = SessionId('search-detached-other')
    await expect(service.handle('session/files/search', { sessionId: other, query: 'src' },
      new AbortController().signal)).resolves.toMatchObject({ ok: false })
    expect(list).not.toHaveBeenCalled()
  } finally {
    await service.close()
  }
})

it('passes the query through unchanged so a parent-escaping mention never widens the workspace', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-search-boundary-'))
  const workspace = join(temp, 'workspace')
  await mkdir(workspace)
  await writeFile(join(workspace, 'inside.txt'), 'inside\n')
  // One level above the workspace: never addressable through an `@` mention.
  await writeFile(join(temp, 'outside.txt'), 'outside\n')
  const id = SessionId('search-boundary')
  const fs = new LocalFileSystemBackend(resolveLocalFilesystemConfig({ cwd: workspace }))
  const list = vi.fn(async (_agent: unknown, _session: unknown, _query: string,
    _signal: AbortSignal): Promise<FileReferenceCandidate[]> => [])
  const { service } = serviceFor(workspace, id, fs, { list } as unknown as NativeFileReferenceOperations)
  try {
    // Containment is the file-reference Provider's job: its reader resolves every
    // listing through the injected `fs` and drops anything `contains` rejects.
    // This endpoint must not rewrite or normalise the query, or it would decide
    // containment itself and could disagree with that reader.
    await value(service.handle('session/files/search',
      { sessionId: id, query: '../outside' }, new AbortController().signal))
    expect(list.mock.calls[0]?.[2]).toBe('../outside')
    await value(service.handle('session/files/search',
      { sessionId: id, query: '../../etc/passwd' }, new AbortController().signal))
    expect(list.mock.calls[1]?.[2]).toBe('../../etc/passwd')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
