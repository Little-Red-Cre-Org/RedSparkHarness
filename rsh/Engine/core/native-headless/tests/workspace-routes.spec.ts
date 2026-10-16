/** Workspace route retirement remains exclusive until its cleanup settles. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { FsTargetKey } from '@deepseek-ai/dsh-fs/native'
import type { NativeRootRoute, NativeRootRouteId } from '@deepseek-ai/dsh-native-session-execution'
import { NativeSandboxPolicy } from '@deepseek-ai/dsh-native-sandbox-policy'
import { WorkspaceId, type Workspace } from '@deepseek-ai/dsh-workspace-definition'
import { NativeWorkspaceRoutes } from '../src/workspace-routes.ts'

async function fixture(outsidePolicyRoot = false) {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-workspace-routes-'))
  const policyRoot = outsidePolicyRoot ? await mkdtemp(join(tmpdir(), 'rsh-workspace-policy-')) : directory
  const workspaceId = WorkspaceId('workspace')
  const workspace: Workspace = {
    id: workspaceId,
    path: directory,
    title: 'Workspace',
    createdAt: '',
    updatedAt: '',
    sessionIds: [],
    setTitle: async () => {},
    attachSession: async () => {},
    insertSessionBefore: async () => {},
    detachSession: async () => {},
    status: async () => 'ok',
  }
  const baseId = brandString<NativeRootRouteId>('base')
  const base: NativeRootRoute = {
    id: baseId,
    configuration: { cwd: policyRoot, provider: 'test', model: 'test', systemPrompt: '', maxSteps: 1 },
  }
  const routes = new NativeWorkspaceRoutes(base, { maxRoutes: 1, allowedRoots: [directory] }, {
    get: id => id === workspace.id ? workspace : undefined,
    create: async () => workspace,
  }, {
    resolve: async path => ({ targetKey: FsTargetKey(path), displayPath: path }),
    processPath: target => target.displayPath,
    sandboxMode: outsidePolicyRoot ? 'workspace-write' : undefined,
  }, outsidePolicyRoot ? new NativeSandboxPolicy({ mode: 'workspace-write', workspaceRoot: policyRoot }) : undefined,
  new AbortController().signal, () => false)
  const route = await routes.select(baseId, workspaceId, new AbortController().signal)
  return {
    baseId,
    directory,
    route,
    routes,
    workspaceId,
    async close() {
      await routes.close()
      await rm(directory, { recursive: true, force: true })
      if (policyRoot !== directory) await rm(policyRoot, { recursive: true, force: true })
    },
  }
}

it('rejects route selection and admission until retirement withdraws the route', async () => {
  const state = await fixture()
  const retireStarted = Promise.withResolvers<undefined>()
  const finishRetirement = Promise.withResolvers<undefined>()
  const release = state.routes.release(state.route.id, async () => {
    retireStarted.resolve(undefined)
    await finishRetirement.promise
  })
  try {
    await retireStarted.promise
    expect(() => state.routes.resolve(state.route.id)).toThrow('Workspace route is busy')
    expect(() => state.routes.select(state.baseId, state.workspaceId, new AbortController().signal))
      .toThrow('Workspace route is busy')
    await expect(state.routes.createWorkspace(state.baseId, state.directory, new AbortController().signal))
      .rejects.toThrow('Workspace route is busy')
    expect(state.routes.list()).toEqual([state.route])

    finishRetirement.resolve(undefined)
    await release
    expect(state.routes.list()).toEqual([])
    expect(() => state.routes.resolve(state.route.id)).toThrow('native-headless: unknown root route')
  } finally {
    finishRetirement.resolve(undefined)
    try { await release } finally { await state.close() }
  }
})

it('keeps a route selected and selectable when retirement fails', async () => {
  const state = await fixture()
  const failure = new Error('retirement failed')
  try {
    await expect(state.routes.release(state.route.id, async () => { throw failure })).rejects.toBe(failure)
    expect(state.routes.resolve(state.route.id)).toBe(state.route)
    await expect(state.routes.select(state.baseId, state.workspaceId, new AbortController().signal))
      .resolves.toBe(state.route)
  } finally {
    await state.close()
  }
})

it('admits an allowed Workspace outside a confined policy root', async () => {
  const state = await fixture(true)
  try {
    expect(state.route.configuration.cwd).toBe(state.directory)
  } finally {
    await state.close()
  }
})
