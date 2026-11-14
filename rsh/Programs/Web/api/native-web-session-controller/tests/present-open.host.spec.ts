/** Native declared-file routes verify Session facts before opening the Host desktop. */
import { beforeEach, expect, it, vi } from 'vitest'
import { SessionId, SessionSeq } from '@redspark/rsh-session/native'
import type { SessionEvent } from '@redspark/rsh-session/types'
import type { NativeActiveSessionOperations } from '@redspark/rsh-native-session-execution'
import type { NativeSessionPersistenceOperations } from '@redspark/rsh-session-persistence/native'
import type { FileSystemOperations } from '@redspark/rsh-fs/native'
import { NativeWebSessionService, resolveNativeWebSessionConfig } from '../src/native.ts'

const opener = vi.hoisted(() => ({ open: vi.fn(async () => {}), reveal: vi.fn(async () => {}) }))

vi.mock('@redspark/rsh-native-command', async importOriginal => ({
  ...(await importOriginal<typeof import('@redspark/rsh-native-command')>()),
  canOpenNativePath: () => true,
  nativeFileManager: () => 'directory',
  openNativePath: opener.open,
  revealNativePath: opener.reveal,
}))

beforeEach(() => {
  opener.open.mockClear()
  opener.reveal.mockClear()
})

const id = SessionId('declared-files')
const presented = {
  type: 'deliverables/presented', seq: SessionSeq(4), time: 4_000,
  data: { turn: 1, callId: 'present-1', files: [
    { path: 'report.txt', description: 'Final report' },
    { path: '../outside.txt' },
  ] },
} as SessionEvent

function serviceWith(events: readonly SessionEvent[], contained = true) {
  const persistence = {
    open: async () => ({
      header: { cwd: '/work' },
      read: async () => ({ events }),
      close: async () => {},
    }),
  } as unknown as NativeSessionPersistenceOperations
  const active = {
    owners: () => [], owner: () => undefined,
    onAttached: () => async () => {}, onDetached: () => async () => {},
  } as unknown as NativeActiveSessionOperations
  const fileSystem = {
    resolve: async (path: string, options?: { cwd?: string }) => ({
      key: path.startsWith('/') ? path : `${options?.cwd ?? '/work'}/${path}`,
    }),
    contains: (_root: { key: string }, target: { key: string }) => contained && target.key.startsWith('/work/'),
    stat: async () => ({ type: 'file' }),
    processPath: (target: { key: string }) => target.key,
    hostPathFor: (path: string) => path,
  } as unknown as FileSystemOperations
  const signal = new AbortController()
  return { persistence, active, fileSystem, signal }
}

function service(persistence: NativeSessionPersistenceOperations, active: NativeActiveSessionOperations,
  fileSystem: FileSystemOperations, signal: AbortSignal) {
  return new NativeWebSessionService(
    { dispose: async () => {} } as unknown as ConstructorParameters<typeof NativeWebSessionService>[0],
    persistence, active,
    resolveNativeWebSessionConfig({ cwd: '/work', provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.',
      maxSteps: 1, builtinTools: false, maxPendingRequests: 1, maxHistoryEvents: 10, maxPromptChars: 100,
      maxFollowBufferBytes: 1024, maxFollowers: 1, maxPendingHumanRequests: 1 }),
    signal, {}, () => {}, fileSystem)
}

function openUrl(seq = 4, index = 0, action = 'open'): Request {
  return new Request(`http://localhost/api/present.open?sessionId=${id}&seq=${seq}&index=${index}&action=${action}`)
}

it('reports the Host desktop based on the native opener', async () => {
  const { persistence, active, fileSystem, signal } = serviceWith([presented])
  const instance = service(persistence, active, fileSystem, signal.signal)
  try {
    await expect(instance.presentHost().json()).resolves.toEqual({ name: expect.any(String) as string,
      available: true, fileManager: 'directory' })
  } finally {
    await instance.close()
  }
})

it('opens and reveals a declared file after verifying its workspace target', async () => {
  const { persistence, active, fileSystem, signal } = serviceWith([presented])
  const instance = service(persistence, active, fileSystem, signal.signal)
  try {
    expect((await instance.presentOpen(openUrl())).status).toBe(204)
    expect(opener.open).toHaveBeenCalledWith('/work/report.txt', expect.any(AbortSignal) as AbortSignal)
    expect((await instance.presentOpen(openUrl(4, 0, 'reveal'))).status).toBe(204)
    expect(opener.reveal).toHaveBeenCalledWith('/work/report.txt', expect.any(AbortSignal) as AbortSignal)
  } finally {
    await instance.close()
  }
})

it('refuses missing events, invalid coordinates, and targets outside the workspace', async () => {
  const { persistence, active, fileSystem, signal } = serviceWith([presented])
  const instance = service(persistence, active, fileSystem, signal.signal)
  try {
    expect((await instance.presentOpen(openUrl(9))).status).toBe(404)
    expect((await instance.presentOpen(openUrl(4, 9))).status).toBe(404)
    expect((await instance.presentOpen(openUrl(4, 0, 'delete'))).status).toBe(400)
    const outside = serviceWith([presented], false)
    const refusing = service(outside.persistence, outside.active, outside.fileSystem, outside.signal.signal)
    try {
      expect((await refusing.presentOpen(openUrl(4, 1))).status).toBe(422)
      expect(opener.open).not.toHaveBeenCalled()
    } finally {
      await refusing.close()
    }
  } finally {
    await instance.close()
  }
})
