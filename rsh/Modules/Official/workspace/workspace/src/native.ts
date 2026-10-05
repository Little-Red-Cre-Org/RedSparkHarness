/** Native Workspace Definition and Provider over the existing v2 domain and exact persistence authority. */
import { z } from 'zod'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/native'
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type {} from '@deepseek-ai/dsh-storage-domain/native'
import type {} from '@deepseek-ai/dsh-session-persistence/native'
import { WorkspaceRegistryRuntime } from './runtime.ts'

export { WorkspaceRegistryRuntime } from './runtime.ts'
export type { WorkspaceRegistryPort } from './runtime.ts'
export { WorkspaceId } from './workspace-types.ts'
export type { Workspace } from './workspace-types.ts'
export { WorkspaceUnknownSessionError, WorkspaceOrderInvalidError } from './errors.ts'
export { WorkspaceMoveInvalidError } from './entity.ts'
export { workspaceDomainSpec, workspaceDomainState, workspaceRecord } from './spec.ts'
export type { WorkspaceDomainState, WorkspaceRecord } from './spec.ts'

/** Native archive target validation limits; the existing persistence reader may materialize data before event-count validation. */
export interface NativeWorkspaceConfiguration {
  readonly maxArchiveSessionBytes: number
  readonly maxArchiveSessionEvents: number
}

/**
 * Resolve deployment limits before any Workspace domain is opened.
 * @param input - untrusted profile configuration.
 * @returns immutable validated limits for exact archive target reads.
 */
export function resolveNativeWorkspaceConfiguration(input: unknown): NativeWorkspaceConfiguration {
  return Object.freeze(z.object({
    maxArchiveSessionBytes: z.number().int().positive().default(16 * 1024 * 1024),
    maxArchiveSessionEvents: z.number().int().positive().default(100000),
  }).strict().parse(input ?? {}))
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { workspaceRegistry: WorkspaceRegistryRuntime }
}

/** Native Provider retains the shared v2 record, global archive order, and existing domain write queues. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-workspace', targets: ['host'],
  requires: ['storageDomain', 'sessionPersistence', 'activeSessions'], provides: ['workspaceRegistry'],
  resolve(input) {
    const config = resolveNativeWorkspaceConfiguration(input)
    return async (context) => {
      const persistence = context.require('sessionPersistence')
      const active = context.require('activeSessions')
      const owners = new Map<SessionId, NativeActiveSessionOwner>()
      let closing = false
      const current = (id: SessionId) => {
        const owner = owners.get(id)
        return owner !== undefined && active.owner(owner.agent, owner.session) === owner ? owner.session.header : undefined
      }
      const registry = new WorkspaceRegistryRuntime({
        domain: context.require('storageDomain'),
        listStored: () => persistence.list(),
        liveHeader: current,
        liveHeaders: () => [...owners.keys()].flatMap((id) => { const header = current(id); return header === undefined ? [] : [header] }),
        archiveHeader: async (id, _known, callerSignal) => {
          const signal = callerSignal === undefined ? context.signal : AbortSignal.any([callerSignal, context.signal])
          signal.throwIfAborted()
          const before = await persistence.stat(id, { signal })
          if (before === undefined) return undefined
          if (before?.sizeBytes !== undefined && before.sizeBytes > config.maxArchiveSessionBytes) throw new Error('Archive target exceeds the configured byte limit')
          await using handle = await persistence.open(id, 'read', { signal })
          const result = await handle.read(0, config.maxArchiveSessionEvents + 1, { signal })
          if (result.events.length > config.maxArchiveSessionEvents) throw new Error('Archive target exceeds the configured event limit')
          const after = await persistence.stat(id, { signal })
          if (after?.sizeBytes !== undefined && after.sizeBytes > config.maxArchiveSessionBytes) throw new Error('Archive target exceeds the configured byte limit')
          if (before?.revision !== after?.revision) throw new Error('Archive target changed during validation')
          signal.throwIfAborted()
          return handle.header
        },
        warning: (message) => { console.warn(message) },
      })
      const removeAttach = active.onAttached((owner) => {
        if (closing) throw new Error('Workspace Provider is closing')
        if (active.owner(owner.agent, owner.session) !== owner) throw new Error('Workspace observed a released Session owner')
        const previous = owners.get(owner.session.id)
        if (previous !== undefined && previous !== owner) throw new Error('Workspace observed two live owners for one Session')
        owners.set(owner.session.id, owner)
        return Promise.resolve()
      })
      const removeDetach = active.onDetached((owner) => {
        if (owners.get(owner.session.id) === owner) owners.delete(owner.session.id)
        return Promise.resolve()
      })
      for (const owner of active.owners()) owners.set(owner.session.id, owner)
      context.own(async () => {
        closing = true
        const results = await Promise.allSettled([removeAttach(), removeDetach(), registry.close()])
        owners.clear()
        const failures = results.filter(result => result.status === 'rejected').map(result => result.reason as unknown)
        if (failures.length > 0) throw new AggregateError(failures, 'Workspace Provider cleanup failed')
      })
      await registry.initialize()
      context.provide('workspaceRegistry', registry)
    }
  },
}
