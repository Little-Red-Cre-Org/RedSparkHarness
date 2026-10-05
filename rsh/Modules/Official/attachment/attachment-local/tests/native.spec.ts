import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { LocalAttachmentBackend } from '../src/backend.ts'
import { NativeLocalAttachmentStore } from '../src/native.ts'

it('closes a paused file stream without waiting for its consumer to resume', async () => {
  const home = await mkdtemp(join(tmpdir(), 'rsh-native-attachment-stream-'))
  const service = new NativeLocalAttachmentStore(new LocalAttachmentBackend({ dshHome: home }))
  try {
    const ref = await service.saveFile({ data: new Uint8Array(256 * 1024), name: 'large.bin' })
    const stream = service.readFileStream(ref)[Symbol.asyncIterator]()
    expect((await stream.next()).done).toBe(false)
    await service.close()
    await expect(stream.next()).rejects.toThrow('provider is closing')
    const cleanupFailure = new Error('file stream close failed')
    const backend = new LocalAttachmentBackend({ dshHome: home })
    backend.readFileStream = () => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: Uint8Array.of(1) }),
        return: () => { throw cleanupFailure },
      }),
    })
    const failed = new NativeLocalAttachmentStore(backend)
    const held = failed.readFileStream(ref)[Symbol.asyncIterator]()
    await held.next()
    const failedClose = failed.close()
    expect(failed.close()).toBe(failedClose)
    await expect(failedClose).rejects.toBe(cleanupFailure)
    await expect(held.next()).rejects.toThrow('provider is closing')
  } finally {
    await service.close()
    await rm(home, { recursive: true, force: true })
  }
})
