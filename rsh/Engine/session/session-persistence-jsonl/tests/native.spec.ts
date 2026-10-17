/** Native installation reuses released JSONL storage and restores the Session authority. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, parseNativeEntryManifest, resolveInstallation, validateNativePluginEntry, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { JsonlSessionBackend } from '../src/index.ts'
import { generationLogFilename } from '../src/format.ts'
import { inspectSessionRootCompression, plugin } from '../src/native.ts'

it.each([
  {
    name: 'a root that is a file',
    prepare: async (temporary: string) => {
      const root = join(temporary, 'root-file')
      await writeFile(root, '')
      return { root, expectedError: 'ENOTDIR' }
    },
  },
  {
    name: 'a canonical generation directory',
    prepare: async (temporary: string) => {
      const root = join(temporary, 'root')
      const generation = join(root, 'project', 'session', generationLogFilename(1, 'none'))
      await mkdir(generation, { recursive: true })
      return { root, expectedError: 'committed generation is not a file' }
    },
  },
  {
    name: 'a retained payload that is a file',
    prepare: async (temporary: string) => {
      const root = join(temporary, 'root')
      const payload = join(root, '.rsh-session-trash', 'deleted', 'payload')
      await mkdir(join(root, '.rsh-session-trash', 'deleted'), { recursive: true })
      await writeFile(payload, '')
      return { root, expectedError: 'ENOTDIR' }
    },
  },
  {
    name: 'a plain legacy flat artifact',
    prepare: async (temporary: string) => {
      const root = join(temporary, 'root')
      const project = join(root, 'project')
      await mkdir(project, { recursive: true })
      await writeFile(join(project, 'session.jsonl'), '')
      return { root, expectedError: 'legacy flat session artifact' }
    },
  },
  {
    name: 'a compressed legacy flat artifact',
    prepare: async (temporary: string) => {
      const root = join(temporary, 'root')
      const project = join(root, 'project')
      await mkdir(project, { recursive: true })
      await writeFile(join(project, 'session.v1.jsonl.zstd'), '')
      return { root, expectedError: 'legacy flat session artifact' }
    },
  },
  {
    name: 'a retained Session root that is a file',
    prepare: async (temporary: string) => {
      const root = join(temporary, 'root')
      await mkdir(root)
      await writeFile(join(root, '.rsh-session-trash'), '')
      return { root, expectedError: 'retained Session root is not a directory' }
    },
  },
  {
    name: 'unrelated files, an incomplete retained entry, and a noncanonical artifact',
    prepare: async (temporary: string) => {
      const root = join(temporary, 'root')
      const trash = join(root, '.rsh-session-trash')
      const project = join(root, 'project')
      const session = join(project, 'session')
      await mkdir(join(trash, 'deleted'), { recursive: true })
      await mkdir(session, { recursive: true })
      await writeFile(join(root, 'project-file'), '')
      await writeFile(join(trash, 'orphan'), '')
      await writeFile(join(project, 'session-file'), '')
      await writeFile(join(session, 'session.v01.jsonl'), '')
      return { root }
    },
  },
])('inspects Session storage at $name', async ({ prepare }) => {
  const temporary = await mkdtemp(join(tmpdir(), 'rsh-session-root-inspection-'))
  try {
    const { root, expectedError } = await prepare(temporary)
    if (expectedError === undefined) {
      await expect(inspectSessionRootCompression(root)).resolves.toBeUndefined()
    } else {
      await expect(inspectSessionRootCompression(root)).rejects.toThrow(expectedError)
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

it.each([
  { name: 'null', config: null, expectedError: 'configuration must be an object' },
  { name: 'a string', config: 'invalid', expectedError: 'configuration must be an object' },
  { name: 'an array', config: [], expectedError: 'configuration must be an object' },
  { name: 'an unknown field', config: { root: tmpdir(), extra: true }, expectedError: 'unknown configuration field extra' },
  { name: 'a missing root', config: {}, expectedError: 'root must be an absolute path' },
  { name: 'an empty root', config: { root: '' }, expectedError: 'root must be an absolute path' },
  { name: 'a relative root', config: { root: 'relative' }, expectedError: 'root must be an absolute path' },
  { name: 'an unsupported encoding', config: { root: tmpdir(), compression: 'gzip' }, expectedError: 'compression must be none or zstd' },
  { name: 'the default encoding', config: { root: tmpdir() } },
  { name: 'Zstandard encoding', config: { root: tmpdir(), compression: 'zstd' } },
])('validates provider config: $name', ({ config, expectedError }) => {
  if (expectedError === undefined) {
    expect(() => plugin.resolve(config)).not.toThrow()
  } else {
    expect(() => plugin.resolve(config)).toThrow(expectedError)
  }
})

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
