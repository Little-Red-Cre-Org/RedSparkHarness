/** Native permission presets persist through the exact Program-owned Session writer. */
import { z } from 'zod'
import type { NativeActiveSessionOperations } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { sessionApprovalPolicy } from '@deepseek-ai/dsh-approval-definition'
import type {} from '@deepseek-ai/dsh-sandbox/native-types'
import type {} from './native-definition.ts'
import type { NativePermissionPresetOperations, NativePermissionPresetSpec } from './native-definition.ts'
import { defaultPermissionPresets } from './presets.ts'
import type {} from '@deepseek-ai/dsh-native-sandbox-policy/native'

const presetSpec = z.strictObject({
  sandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']),
  approval: z.enum(['ask', 'never']),
  name: z.string().optional(),
  description: z.string().optional(),
})

function resolveConfig(input: unknown): Readonly<Record<string, Readonly<NativePermissionPresetSpec>>> {
  const parsed = z.strictObject({ presets: z.record(z.string(), presetSpec).default(defaultPermissionPresets) }).parse(input ?? {})
  if (Object.keys(parsed.presets).length === 0 || 'custom' in parsed.presets) {
    throw new Error('permission-presets: native presets must be non-empty and cannot use the reserved custom id')
  }
  return Object.freeze(Object.fromEntries(Object.entries(parsed.presets).map(([id, spec]) => [id, Object.freeze(spec)])))
}

/** Native host preset Provider. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-permission-presets',
  targets: ['host'],
  requires: ['activeSessions', 'agents', 'sandboxPolicy', 'approval'],
  provides: ['permissionPresets'],
  resolve(input) {
    const presets = resolveConfig(input)
    return (context) => {
      const active = context.require('activeSessions') as Pick<NativeActiveSessionOperations, 'owner'>
      const agents = context.require('agents') as Pick<NativeAgentRegistry, 'get'>
      const service: NativePermissionPresetOperations = {
        resolve(name) {
          const spec = presets[name]
          if (spec === undefined) throw new Error(`permission-presets: unknown native preset ${JSON.stringify(name)}`)
          return spec
        },
        async apply(owner, name, signal) {
          signal.throwIfAborted()
          const assertOwner = (): void => {
            signal.throwIfAborted()
            if (owner.invocation !== 'root' || !owner.writerAvailable || agents.get(owner.agent.id) !== owner.agent
              || active.owner(owner.agent, owner.session) !== owner) {
              throw new Error('permission-presets: exact writable root owner is unavailable')
            }
          }
          assertOwner()
          const spec = service.resolve(name)
          const currentEvents = await owner.readEvents({ signal })
          const currentPreset = currentEvents.findLast(event => event.type === 'permission/preset')
          assertOwner()
          if (currentPreset?.type !== 'permission/preset' || currentPreset.data.preset !== name) {
            owner.append('permission/preset', { preset: name })
          }
          const currentSandbox = currentEvents.findLast(event => event.type === 'sandbox/mode')
          if (currentSandbox?.type !== 'sandbox/mode' || currentSandbox.data.mode !== spec.sandbox) {
            owner.append('sandbox/mode', { mode: spec.sandbox })
          }
          if (sessionApprovalPolicy(owner.session) !== spec.approval) {
            owner.append('approval/policy', { policy: spec.approval })
          }
          assertOwner()
          await owner.flush()
          assertOwner()
        },
      }
      context.provide('permissionPresets', service)
    }
  },
}

export type { NativePermissionPresetOperations, NativePermissionPresetSpec } from './native-definition.ts'
