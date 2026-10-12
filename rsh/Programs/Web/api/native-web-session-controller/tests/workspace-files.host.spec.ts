/** Native Session file RPCs stay inside the selected Session workspace. */
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { LocalFileSystemBackend, resolveLocalFilesystemConfig } from '@deepseek-ai/dsh-fs-local/backend'
import type { NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import type { NativeActiveSessionOperations } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session/native'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection/native-host'
import { NativeWebSessionService, resolveNativeWebSessionConfig } from '../src/native.ts'

function serviceFor(workspace: string, id: ReturnType<typeof SessionId>, fs: LocalFileSystemBackend): NativeWebSessionService {
  const header = { id, version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false, cwd: workspace }
  const persistence = { stat: async () => ({ header }) } as unknown as NativeSessionPersistenceOperations
  const active = {
    owners: () => [], onAttached: () => async () => {}, onDetached: () => async () => {},
  } as unknown as NativeActiveSessionOperations
  return new NativeWebSessionService(
    { dispose: async () => undefined } as unknown as NativeHeadlessApplication,
    persistence,
    active,
    resolveNativeWebSessionConfig({ cwd: workspace, provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.',
      maxSteps: 1, builtinTools: false, maxPendingRequests: 1, maxHistoryEvents: 10, maxPromptChars: 100,
      maxFollowBufferBytes: 1024, maxFollowers: 2, maxPendingHumanRequests: 1 }),
    new AbortController().signal,
    {},
    undefined,
    fs,
  )
}

async function value(result: Promise<ConnectionRpcResult<unknown>>): Promise<unknown> {
  const reply = await result
  if (!reply.ok) throw new Error(reply.error.message)
  return reply.value
}

it('lists the workspace and reads line pages and complete bytes', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-native-session-files-'))
  const workspace = join(temp, 'workspace')
  await mkdir(workspace)
  const id = SessionId('workspace-files-happy')
  const fs = new LocalFileSystemBackend(resolveLocalFilesystemConfig({ cwd: workspace }))
  const service = serviceFor(workspace, id, fs)
  try {
    await writeFile(join(workspace, 'notes.txt'), 'first\nsecond\n')
    await writeFile(join(workspace, 'image.bin'), Uint8Array.from([0, 255, 1]))
    await expect(value(service.handle('session/files/list', { sessionId: id, path: '.' }, new AbortController().signal)))
      .resolves.toMatchObject({ path: '', truncated: false, entries: [
        { name: 'image.bin', type: 'file', size: 3 }, { name: 'notes.txt', type: 'file', size: 13 },
      ] })
    await expect(value(service.handle('session/files/read', {
      sessionId: id, path: 'notes.txt', range: { offset: 2, limit: 1 },
    }, new AbortController().signal))).resolves.toMatchObject({ offset: 2, text: 'second', lines: 1, eof: true, bytes: 13 })
    await expect(value(service.handle('session/files/read-all', { sessionId: id, path: 'image.bin' }, new AbortController().signal)))
      .resolves.toMatchObject({ offset: 0, data: Buffer.from([0, 255, 1]).toString('base64'), eof: true, bytes: 3 })
  } finally {
    await service.close()
    await fs.close()
    await rm(temp, { recursive: true, force: true })
  }
})

it('rejects traversal and a path that resolves through a symlink outside the workspace', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-native-session-files-'))
  const workspace = join(temp, 'workspace')
  const outside = join(temp, 'outside')
  await mkdir(workspace)
  await mkdir(outside)
  await writeFile(join(outside, 'secret.txt'), 'private')
  await writeFile(join(workspace, 'base.txt'), 'base')
  await symlink(outside, join(workspace, 'escape'))
  const id = SessionId('workspace-files-escape')
  const fs = new LocalFileSystemBackend(resolveLocalFilesystemConfig({ cwd: workspace }))
  const service = serviceFor(workspace, id, fs)
  try {
    for (const path of ['../outside/secret.txt', join(outside, 'secret.txt'), 'escape/secret.txt']) {
      await expect(service.handle('session/files/read-all', { sessionId: id, path }, new AbortController().signal))
        .resolves.toMatchObject({ ok: false, error: { code: 'native/session-files' } })
    }
    await expect(service.handle('session/files/read-related', {
      sessionId: id, path: 'base.txt', relativePath: '../outside/secret.txt',
    }, new AbortController().signal)).resolves.toMatchObject({ ok: false, error: { code: 'native/session-files' } })
  } finally {
    await service.close()
    await fs.close()
    await rm(temp, { recursive: true, force: true })
  }
})
