/** Direct backend use preserves filesystem behavior without service registration. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { LocalFileSystemBackend } from '../src/backend.ts'

it('performs guarded writes and edits directly and preserves data after cancellation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-fs-backend-'))
  try {
    const backend = new LocalFileSystemBackend({ cwd: directory, diffBasisMaxBytes: 1024 })
    const target = await backend.resolve('note.txt')
    const created = await backend.writeText(target, 'one', { kind: 'createIfAbsent' })
    const edited = await backend.editText(target, { oldString: 'one', newString: 'two', replaceAll: false }, { version: created.version })
    expect(await backend.readText(target)).toBe('two')
    await expect(backend.writeText(target, 'stale', { kind: 'replaceIfVersion', version: created.version }))
      .rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    const controller = new AbortController()
    controller.abort()
    await expect(backend.writeText(target, 'cancelled', { kind: 'replaceIfVersion', version: edited.version }, controller.signal))
      .rejects.toMatchObject({ code: 'FS_ABORTED' })
    expect(await readFile(join(directory, 'note.txt'), 'utf8')).toBe('two')
    expect(backend.sandboxMode).toBeUndefined()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
