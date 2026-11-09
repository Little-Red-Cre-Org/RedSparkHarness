/** Native permission presets persist through the exact Program-owned Session writer. */
import { z } from 'zod'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from '@redspark/rsh-native-session-execution'
import type { NativeAgentRegistry } from '@redspark/rsh-native-agent'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import { sessionApprovalPolicy } from '@redspark/rsh-approval-definition'
import type {} from '@redspark/rsh-sandbox/native-types'
import type {} from './native-definition.ts'
import type { NativePermissionPresetControls, NativePermissionPresetOperations, NativePermissionPresetSpec } from './native-definition.ts'
import { CUSTOM_PRESET, defaultPermissionPresets } from './presets.ts'
import type {} from '@redspark/rsh-native-sandbox-policy/native'

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
  name: '@redspark/rsh-permission-presets',
  targets: ['host'],
  requires: ['activeSessions', 'agents', 'sandboxPolicy', 'approval'],
  provides: ['permissionPresets'],
  resolve(input) {
    const presets = resolveConfig(input)
    return (context) => {
      const active = context.require('activeSessions') as Pick<NativeActiveSessionOperations, 'owner'>
      const agents = context.require('agents') as Pick<NativeAgentRegistry, 'get'>
      const sandboxPolicy = context.require('sandboxPolicy')
      const approval = context.require('approval')
      const assertOwner = (owner: NativeActiveSessionOwner, signal: AbortSignal): void => {
        signal.throwIfAborted()
        if (owner.invocation !== 'root' || !owner.writerAvailable || agents.get(owner.agent.id) !== owner.agent
          || active.owner(owner.agent, owner.session) !== owner) {
          throw new Error('permission-presets: exact writable root owner is unavailable')
        }
      }
      const currentValue = (owner: NativeActiveSessionOwner, events: Awaited<ReturnType<NativeActiveSessionOwner['readEvents']>>): string => {
        const sandbox = events.findLast(event => event.type === 'sandbox/mode')
        const sandboxMode = sandbox?.type === 'sandbox/mode'
          ? sandbox.data.mode : sandboxPolicy.resolve({ session: owner.session }).mode
        const approvalPolicy = sessionApprovalPolicy(owner.session) ?? approval.policy
        const matches = (spec: NativePermissionPresetSpec): boolean =>
          spec.sandbox === sandboxMode && spec.approval === approvalPolicy
        const selected = events.findLast(event => event.type === 'permission/preset')
        const name = selected?.type === 'permission/preset' ? selected.data.preset : undefined
        const spec = name === undefined ? undefined : presets[name]
        return name !== undefined && spec !== undefined && matches(spec)
          ? name : Object.entries(presets).find(([, spec]) => matches(spec))?.[0] ?? CUSTOM_PRESET
      }
      const controls = async (owner: NativeActiveSessionOwner, signal: AbortSignal): Promise<NativePermissionPresetControls> => {
        assertOwner(owner, signal)
        const events = await owner.readEvents({ signal })
        assertOwner(owner, signal)
        const selectedValue = currentValue(owner, events)
        return { currentValue: selectedValue, options: [
          ...Object.entries(presets).map(([value, spec]) => ({ value, name: spec.name ?? value,
            ...spec.description === undefined ? {} : { description: spec.description } })),
          ...selectedValue === CUSTOM_PRESET ? [{ value: CUSTOM_PRESET, name: 'Custom',
            description: 'Current sandbox and approval settings do not match a preset.' }] : [],
        ] }
      }
      const service: NativePermissionPresetOperations = {
        controls,
        resolve(name) {
          const spec = presets[name]
          if (spec === undefined) throw new Error(`permission-presets: unknown native preset ${JSON.stringify(name)}`)
          return spec
        },
        async apply(owner, name, signal) {
          assertOwner(owner, signal)
          const spec = service.resolve(name)
          const currentEvents = await owner.readEvents({ signal })
          const currentPreset = currentEvents.findLast(event => event.type === 'permission/preset')
          assertOwner(owner, signal)
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
          assertOwner(owner, signal)
          await owner.flush()
          assertOwner(owner, signal)
        },
      }
      // A fresh Session carries its standing permission facts before its first model
      // admission, the guarantee the Cordis owner gives on `session/created`. Without
      // it a Native Session enforces a policy its log never records.
      const owners = active as Pick<NativeActiveSessionOperations, 'owner' | 'onAttached'>
      const seeded = new WeakSet<NativeActiveSessionOwner>()
      context.effect(owners.onAttached(async (owner) => {
        if (owner.invocation !== 'root' || !owner.writerAvailable || seeded.has(owner)) return
        seeded.add(owner)
        const events = await owner.readEvents({ signal: new AbortController().signal })
        const loggedSandbox = events.findLast(event => event.type === 'sandbox/mode')
        const loggedApproval = events.findLast(event => event.type === 'approval/policy')
        const loggedPreset = events.findLast(event => event.type === 'permission/preset')
        if (loggedSandbox !== undefined && loggedApproval !== undefined && loggedPreset !== undefined) return
        const name = currentValue(owner, events)
        if (loggedPreset === undefined && name !== CUSTOM_PRESET) owner.append('permission/preset', { preset: name })
        if (loggedSandbox === undefined) {
          owner.append('sandbox/mode', { mode: sandboxPolicy.resolve({ session: owner.session }).mode })
        }
        if (loggedApproval === undefined) owner.append('approval/policy', { policy: approval.policy })
        await owner.flush()
      }))
      context.provide('permissionPresets', service)
    }
  },
}

export type { NativePermissionPresetControls, NativePermissionPresetOperations, NativePermissionPresetOption,
  NativePermissionPresetSpec } from './native-definition.ts'
