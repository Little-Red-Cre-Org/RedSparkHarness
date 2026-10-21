/** Native installation reuses released JSONL storage and restores the Session authority. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, parseNativeEntryManifest, resolveInstallation, validateNativePluginEntry, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { JsonlSessionBackend } from '../src/index.ts'
import { plugin } from '../src/native.ts'

it('matches the published native storage declaration', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    dsh: { native: unknown }
    exports: Record<string, unknown>
  }
  const entry = parseNativeEntryManifest(manifest.dsh.native, new Set(Object.keys(manifest.exports)))
  expect(validateNativePluginEntry(plugin, entry)).toBe(plugin)
})

it('persists, closes, and restores the same Session log without constructing a Context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rsh-native-session-'))
  const scope = new NativeScope()
  let storage: JsonlSessionBackend | undefined
  const consumer: NativePlugin = {
    apiVersion: 1, name: 'native-session-consumer', targets: ['host'], requires: ['sessionPersistence'], provides: [],
    resolve: () => (context) => { const selected = context.require('sessionPersistence'); if (!(selected instanceof JsonlSessionBackend)) throw new Error('Expected selected JSONL backend'); storage = selected },
  }
  const request = { plugin, scope, config: { root, compression: 'none' } }
  const host = new NativeHost(resolveInstallation([request, { plugin: consumer, scope, config: undefined }], 'host'))
  try {
    await host.start()
    if (storage === undefined) throw new Error('missing native storage')
    const firstStorage = storage
    const session = Session.create(SessionId('native-persisted'))
    const writer = await firstStorage.create(session.header)
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await writer.append(session.snapshotEvents())
    await writer.flush()
    await writer.close()
    await host.stop()

    const reopened = new JsonlSessionBackend({ root, compression: 'none' })
    try {
      const reader = await reopened.open(session.id, 'read')
      try {
        const stored = await reader.read()
        const restored = Session.fromRestore(session.id, stored.events, reader.header, SessionLogOffset(0), stored.eventState)
        expect(restored.snapshotEvents().map(event => [event.type, event.seq])).toEqual([
          ['turn/start', 0], ['turn/end', 1], ['session/end-seed', 2],
        ])
      } finally {
        await reader.close()
      }
    } finally {
      await reopened.close()
    }
  } finally {
    await host.stop()
    await rm(root, { recursive: true, force: true })
  }
})
