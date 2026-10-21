/** Actual retained deletion preserves bytes and shares ownership with every writer. */
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it, expect, vi } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session/native'
import { sessionDir } from '../src/format.ts'
import { JsonlSessionBackend } from '../src/backend.ts'
import { SessionWriteLease } from '../src/lease.ts'

async function stored(backend: JsonlSessionBackend, id: string) {
  const session = Session.create(SessionId(id))
  const handle = await backend.create(session.header)
  await handle.flush()
  await handle.close()
  return session.id
}

it('moves real generation bytes outside live storage and reconstructs receipts before exact restoration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rsh-delete-'))
  let backend = new JsonlSessionBackend({ root, compression: 'none' })
  try {
    const id = await stored(backend, 'deleted')
    const receipt = await backend.deletions.delete(id)
    expect(await backend.stat(id)).toBeUndefined()
    expect(await backend.list()).toEqual([])
    await expect(backend.open(id, 'read')).rejects.toThrow()
    const payload = join(root, '.rsh-session-trash', receipt.id, 'payload')
    const files = (await readdir(payload)).filter(file => file.endsWith('.jsonl'))
    const original = await readFile(join(payload, files[0]!), 'utf8')
    await backend.close()
    backend = new JsonlSessionBackend({ root, compression: 'none' })
    expect(await backend.deletions.list()).toEqual([receipt])
    const retainedHeader = await backend.deletions.inspect(receipt.id)
    expect(retainedHeader.id).toBe(id)
    await expect(backend.deletions.restore(receipt.id, { expectedCwd: '/foreign' })).rejects.toThrow('workspace differs')
    const cleanupFailure = new Error('lease cleanup failed')
    const acquire = SessionWriteLease.acquireCombined.bind(SessionWriteLease)
    const intercept = vi.spyOn(SessionWriteLease, 'acquireCombined').mockImplementation(async (...args) => {
      const lease = await acquire(...args)
      const release = lease.release.bind(lease)
      vi.spyOn(lease, 'release').mockImplementation(async () => {
        await release()
        throw cleanupFailure
      })
      return lease
    })
    try {
      const failure: unknown = await backend.deletions.restore(receipt.id, { expectedCwd: '/foreign' }).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(AggregateError)
      if (!(failure instanceof AggregateError)) throw new Error('missing operation and cleanup failures')
      expect(failure.errors).toContain(cleanupFailure)
      const primary: unknown = failure.errors[0]
      expect(primary).toBeInstanceOf(Error)
      if (!(primary instanceof Error)) throw new Error('missing primary failure')
      expect(primary.message).toContain('workspace differs')
    } finally { intercept.mockRestore() }
    expect(await backend.deletions.restore(receipt.id)).toBe(id)
    expect(await backend.deletions.list()).toEqual([])
    await using reader = await backend.open(id, 'read')
    expect(reader.header.id).toBe(id)
    expect(await reader.read()).toMatchObject({ events: [] })
    expect(await readFile(join(sessionDir(root, retainedHeader.cwd, id), files[0]!), 'utf8')).toBe(original)
  } finally { await backend.close(); await rm(root, { recursive: true, force: true }) }
})
