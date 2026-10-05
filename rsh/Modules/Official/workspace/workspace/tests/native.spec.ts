import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as storagePlugin } from '@deepseek-ai/dsh-storage/native'
import { plugin as jsonPlugin } from '@deepseek-ai/dsh-storage-json/native'
import { plugin as domainPlugin } from '@deepseek-ai/dsh-storage-domain/native'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent'
import { plugin as executionPlugin } from '@deepseek-ai/dsh-native-session-execution'
import { plugin as persistencePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session/native'
import { logPath } from '../../../../../Engine/session/session-persistence-jsonl/src/format.ts'
import { plugin, WorkspaceUnknownSessionError, type WorkspaceRegistryRuntime } from '../src/native.ts'

async function start(root: string) {
  const scope = new NativeScope()
  let selected: { registry: WorkspaceRegistryRuntime; persistence: NativeSessionPersistenceOperations } | undefined
  const consumer: NativePlugin = {
    apiVersion: 1, name: 'workspace-native-test-consumer', targets: ['host'],
    requires: ['workspaceRegistry', 'sessionPersistence'], provides: [],
    resolve: () => (context) => { selected = {
      registry: context.require('workspaceRegistry'), persistence: context.require('sessionPersistence'),
    } },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined }, { plugin, scope, config: {} },
    { plugin: persistencePlugin, scope, config: { root: join(root, 'sessions'), compression: 'none' } },
    { plugin: executionPlugin, scope, config: undefined }, { plugin: agentPlugin, scope, config: undefined },
    { plugin: domainPlugin, scope, config: { backend: 'json' } },
    { plugin: jsonPlugin, scope, config: { root: join(root, 'domains') } },
    { plugin: storagePlugin, scope, config: undefined },
  ], 'host'))
  await host.start()
  if (selected === undefined) { await host.stop(); throw new Error('Workspace consumer was not installed') }
  return { host, ...selected }
}

it('retains v2 archive order, workspace accounting and Session generation bytes across native Provider restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rsh-workspace-native-'))
  let state = await start(root)
  try {
    const cwd = join(root, 'project')
    await mkdir(cwd)
    const id = SessionId('accounted')
    await using writer = await state.persistence.create({ id, version: SESSION_FORMAT_VERSION, createdAt: 0, isSeeded: false, cwd })
    await writer.flush()
    await writer.close()
    const workspace = await state.registry.create(cwd)
    await workspace.attachSession(id)
    const file = logPath(join(root, 'sessions'), cwd, id, 'none')
    const original = await readFile(file)
    await state.registry.archiveSession(id)
    await expect(state.registry.archiveSession(SessionId('missing'))).rejects.toBeInstanceOf(WorkspaceUnknownSessionError)
    expect(workspace.sessionIds).toEqual([id])
    const domainFile = join(root, 'domains', 'workspace.json')
    const durable = await readFile(domainFile)
    const stored = JSON.parse(durable.toString()) as { unit: { version: number }; global: { archivedSessionIds: string[] } }
    expect(stored.unit.version).toBe(2)
    expect(stored.global.archivedSessionIds).toEqual([id])
    await state.registry.archiveSession(id)
    expect(await readFile(domainFile)).toEqual(durable)
    await state.host.stop()
    await expect(workspace.setTitle('late')).rejects.toThrow('closing')
    state = await start(root)
    expect(state.registry.archivedSessionIds).toEqual([id])
    expect(state.registry.get(workspace.id)?.sessionIds).toEqual([id])
    expect(await readFile(domainFile)).toEqual(durable)
    expect(await readFile(file)).toEqual(original)
  } finally {
    await state.host.stop()
    await rm(root, { recursive: true })
  }
})
