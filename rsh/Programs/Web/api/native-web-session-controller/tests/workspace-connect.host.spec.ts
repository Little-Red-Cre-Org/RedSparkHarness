/** Workspace connect admits a non-core directory and reports the admission failure. */
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { brandString } from '@redspark/rsh-brand'
import { createNativeHostConnectionRegistry, type ConnectionFetchHandler } from '@redspark/rsh-client-connection/native-host'
import type { CredentialRecord } from '@redspark/rsh-credentials/native'
import { plugin as filesystem } from '@redspark/rsh-fs-local/native'
import type { NativeHeadlessApplication } from '@redspark/rsh-native-headless/native'
import { plugin as agents } from '@redspark/rsh-native-agent/native'
import type { NativeActiveSessionOperations, NativeRootRouteId } from '@redspark/rsh-native-session-execution'
import { plugin as execution } from '@redspark/rsh-native-session-execution/native'
import { plugin as modelExecution } from '@redspark/rsh-native-model-execution/native'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import { plugin as tools } from '@redspark/rsh-native-tools/native'
import type { NativeSessionPersistenceOperations } from '@redspark/rsh-session-persistence/native'
import { plugin as storage } from '@redspark/rsh-session-persistence-jsonl/native'
import { plugin as storageHub } from '@redspark/rsh-storage/native'
import { plugin as storageDomain } from '@redspark/rsh-storage-domain/native'
import { plugin as storageJson } from '@redspark/rsh-storage-json/native'
import { plugin as workspaceRegistry } from '@redspark/rsh-workspace/native'
import { WorkspaceId as workspaceId, type Workspace, type WorkspaceRegistryRuntime } from '@redspark/rsh-workspace/native'
import { textResponse } from '../../../../../Engine/core/agent-loop/tests/mock-adapter.ts'
import { plugin } from '../src/native.ts'
import { NativeWebWorkspaceService } from '../src/workspaces.ts'

interface WorkspaceRpc {
  readonly result: {
    readonly ok: boolean
    readonly value?: {
      readonly workspace?: { readonly workspaceId: string; readonly path: string }
      readonly created?: boolean
      readonly sessionId?: string
    }
    readonly error?: { readonly code: string; readonly message: string; readonly details: { readonly path?: string } }
  }
}

async function withWorkspaceHost(
  run: (call: (method: string, payload: unknown) => Promise<WorkspaceRpc>, workspace: string) => Promise<void>,
): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'rsh-workspace-connect-'))
  const workspace = join(home, 'workspace')
  await mkdir(workspace)
  const scope = new NativeScope()
  let handler: ConnectionFetchHandler | undefined
  const model: NativePlugin = {
    apiVersion: 1, name: 'workspace-connect-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => {
      context.provide('model', { async *stream() { yield* textResponse('ok') } })
    },
  }
  const carrier: NativePlugin = {
    apiVersion: 1, name: 'workspace-connect-carrier', targets: ['host'], requires: [], provides: ['hostConnection'],
    resolve: () => async (context) => {
      let record: CredentialRecord | undefined
      const registry = await createNativeHostConnectionRegistry({}, { async modifyRecord(_key, mutate) {
        record = await mutate(record)
        return record
      } })
      const disposers: Array<() => Promise<void>> = []
      const connection = registry.forOwner({
        effect(setup) {
          const dispose = setup()
          const release = async (): Promise<void> => { await dispose() }
          disposers.push(release)
          return release
        },
        mount() { return () => {} },
      })
      handler = connection.createSharedFetchHandler('/api')
      context.provide('hostConnection', connection)
      context.own(async () => { await Promise.all(disposers.map(dispose => dispose())) })
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin, scope, config: { cwd: workspace, provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.', maxSteps: 2, builtinTools: false,
      maxPendingRequests: 2, maxHistoryEvents: 100, maxPromptChars: 1000, maxFollowBufferBytes: 1000000,
      maxFollowers: 2, maxPendingHumanRequests: 2,
      workspaceRoutes: { maxRoutes: 4, allowedRoots: [workspace] } } },
    ...[agents, execution, modelExecution, tools, model, carrier, workspaceRegistry, storageHub]
      .map(item => ({ plugin: item, scope, config: undefined })),
    { plugin: storage, scope, config: { root: join(home, 'sessions'), compression: 'none' } },
    { plugin: storageJson, scope, config: { root: join(home, 'domains') } },
    { plugin: storageDomain, scope, config: { backend: 'json' } },
    { plugin: filesystem, scope, config: { cwd: workspace } },
  ], 'host'))
  const call = async (method: string, payload: unknown): Promise<WorkspaceRpc> => {
    if (handler === undefined) throw new Error('missing workspace handler')
    const response = await handler.fetch(new Request(`http://127.0.0.1/api/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'workspace-connect', method, payload }),
    }))
    expect(response.status).toBe(200)
    return await response.json() as WorkspaceRpc
  }
  try {
    await host.start()
    await run(call, workspace)
  } finally {
    await host.stop()
    await rm(home, { recursive: true, force: true })
  }
}

function protectedDirectory(): string {
  return process.platform === 'win32' ? 'C:\\Windows' : '/usr'
}

function serviceThatThrows(error: unknown): NativeWebWorkspaceService {
  const id = workspaceId('workspace-connect')
  const workspace = {
    id, path: join(tmpdir(), 'workspace-connect'), title: 'fixture', createdAt: 't', updatedAt: 't', sessionIds: [],
    attachSession: async () => {},
  } as unknown as Workspace
  const registry = {
    list: () => [workspace], archivedSessionIds: [], get: () => workspace,
  } as unknown as WorkspaceRegistryRuntime
  const executor = {
    rootExecution: { workspaceRoutes: () => [{ id: 'route', workspaceId: id }] },
    executeSessionOperation: async () => { throw error },
    dispose: async () => {},
  } as unknown as NativeHeadlessApplication
  return new NativeWebWorkspaceService(
    { on: () => async () => {}, signal: new AbortController().signal },
    registry, executor, {} as NativeSessionPersistenceOperations,
    { owners: () => [] } as unknown as NativeActiveSessionOperations,
    brandString<NativeRootRouteId>('root'), undefined, 10, 1,
  )
}

it('connects a non-core directory under the system temp root', async () => {
  await withWorkspaceHost(async (call, workspace) => {
    const canonical = await realpath(workspace)
    const created = await call('workspaces/create', { path: workspace })
    expect(created.result).toMatchObject({ ok: true, value: { created: true, workspace: { path: canonical } } })
    const id = created.result.value?.workspace?.workspaceId
    if (id === undefined) throw new Error('missing workspace id')
    const connected = await call('workspaces/connect', { workspaceId: id })
    expect(connected.result.ok).toBe(true)
    expect(connected.result.value?.sessionId).toEqual(expect.any(String))
    expect(connected.result.value?.sessionId?.length).toBeGreaterThan(0)
  })
}, 20_000)

it('rejects a protected system directory even when the caller trusts it', async () => {
  await withWorkspaceHost(async (call) => {
    const denied = await call('workspaces/create', { path: protectedDirectory(), trust: true })
    expect(denied.result).toEqual({ ok: false, error: {
      code: 'native/workspace-forbidden', message: 'Workspace is a protected system directory', details: {},
    } })
  })
}, 20_000)

it('rejects a directory outside the configured allowed roots with the path', async () => {
  await withWorkspaceHost(async (call) => {
    const outside = await mkdtemp(join(tmpdir(), 'rsh-workspace-outside-'))
    try {
      const canonical = await realpath(outside)
      const denied = await call('workspaces/create', { path: outside })
      expect(denied.result).toEqual({ ok: false, error: {
        code: 'native/workspace-untrusted', message: 'Workspace is outside the configured allowed roots', details: { path: canonical },
      } })
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
}, 20_000)

it('reports nested session admission failures instead of a generic workspace message', async () => {
  const nested = new AggregateError([
    new AggregateError([new Error("Cannot find module '/fixture/system.node'")], 'native-active-session: lifecycle observer failed'),
  ], 'native-headless: turn cleanup failed')
  const admitted = serviceThatThrows(nested)
  const plain = serviceThatThrows(new Error('Workspace directory is unavailable'))
  const unknown = serviceThatThrows('session store unavailable')
  try {
    await expect(admitted.handle('workspaces/connect', { workspaceId: 'workspace-connect' }, new AbortController().signal)).resolves.toEqual({
      ok: false,
      error: {
        code: 'native/workspaces',
        message: "native-headless: turn cleanup failed: native-active-session: lifecycle observer failed: Cannot find module '/fixture/system.node'",
        details: {},
      },
    })
    await expect(plain.handle('workspaces/connect', { workspaceId: 'workspace-connect' }, new AbortController().signal)).resolves.toEqual({
      ok: false, error: { code: 'native/workspaces', message: 'Workspace directory is unavailable', details: {} },
    })
    await expect(unknown.handle('workspaces/connect', { workspaceId: 'workspace-connect' }, new AbortController().signal)).resolves.toEqual({
      ok: false, error: { code: 'native/workspaces', message: 'session store unavailable', details: {} },
    })
  } finally {
    await admitted.close()
    await plain.close()
    await unknown.close()
  }
})
