// @vitest-environment jsdom
/**
 * Native permission face.
 *
 * The browser half hangs a Settings row and a `/permission` popup on
 * `settingsScope` and `commandUi`; the Native half owns one service over the
 * Settings RPC and the two Cordis-free components a Native seat can render.
 * This suite pins the fold from the redacted schema, the compare-and-set write,
 * and the Full access gate that both builds share.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { makeTranslate } from '@redspark/rsh-client-test-runtime'
import type { NativeSettingsDescriptor } from '@redspark/rsh-client-native-session/native'
import type { SessionId } from '@redspark/rsh-session/types'
import type { NativePermissionRowState } from '../src/native.ts'
import {
  createNativePermissionPresets, FULL_ACCESS_PRESET, NativePermissionRow, permissionDefaults,
} from '../src/native.ts'

type PermissionClient = Parameters<typeof createNativePermissionPresets>[0]
const asClient = (session: ReturnType<typeof client>): PermissionClient =>
  session as unknown as PermissionClient
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh)
const SID = 'permission-session' as SessionId

/** The redacted JSON form of a Schemastery union of string constants. */
function schema(presets: readonly string[]): unknown {
  return {
    uid: 0,
    refs: {
      0: { type: 'object', dict: { defaultPreset: 1 } },
      1: { type: 'union', list: presets.map((_, index) => index + 2) },
      ...Object.fromEntries(presets.map((value, index) => [String(index + 2), { type: 'const', value }])),
    },
  }
}

function descriptor(presets: readonly string[], overrides: Partial<NativeSettingsDescriptor> = {}): NativeSettingsDescriptor {
  return {
    namespace: 'permission',
    schema: schema(presets),
    value: { defaultPreset: presets[0] },
    base: {},
    user: {},
    applies: 'live',
    secrets: [],
    credentialRefs: [],
    revision: 3,
    ...overrides,
  }
}

function client(named: { readonly rows?: readonly NativeSettingsDescriptor[]; readonly mutate?: unknown } = {}) {
  return {
    settingsDescribe: vi.fn(async () => ({
      hasDocument: true,
      namespaces: named.rows ?? [],
      limits: { maxCredentialRefsPerRead: 32, maxSettingsOperations: 128 },
    })),
    settingsMutate: (named.mutate ?? vi.fn(async () => descriptor(['read-only', 'workspace-write']))),
    // Ends immediately: the follow is not what this suite exercises.
    settingsEvents: async function* () { /* no events */ },
    selectPermissionPreset: vi.fn(async () => {}),
  }
}

describe('permissionDefaults', () => {
  it('reads every advertised const in schema order', () => {
    const resolved = permissionDefaults(descriptor(['read-only', 'workspace-write', FULL_ACCESS_PRESET]))
    expect(resolved.currentValue).toBe('read-only')
    expect(resolved.options.map(option => option.id)).toEqual(['read-only', 'workspace-write', FULL_ACCESS_PRESET])
  })

  it('rejects a schema that does not advertise the current default', () => {
    const broken = descriptor(['read-only'], { value: { defaultPreset: 'custom' } })
    expect(() => permissionDefaults(broken)).toThrow('does not advertise its current preset')
  })

  it('rejects a descriptor without a default value', () => {
    const broken = descriptor(['read-only'], { value: {} })
    expect(() => permissionDefaults(broken)).toThrow('has no defaultPreset value')
  })
})

describe('native permission presets service', () => {
  it('reports the namespace as unavailable when the Host serves none', async () => {
    const face = createNativePermissionPresets(asClient(client()), new AbortController().signal)
    await face.load()
    expect(face.getSnapshot().status).toBe('unavailable')
  })

  it('reads the default and advertises the choices', async () => {
    const rows = [descriptor(['read-only', 'workspace-write'])]
    const face = createNativePermissionPresets(asClient(client({ rows })), new AbortController().signal)
    await face.load()
    const state = face.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.currentValue).toBe('read-only')
    expect(state.options.map(option => option.id)).toEqual(['read-only', 'workspace-write'])
    expect(state.revision).toBe(3)
  })

  it('writes the default with the observed revision and folds the answer back', async () => {
    const mutate = vi.fn(async () => descriptor(['read-only', 'workspace-write'], {
      value: { defaultPreset: 'workspace-write' }, revision: 4,
    }))
    const rows = [descriptor(['read-only', 'workspace-write'])]
    const face = createNativePermissionPresets(asClient(client({ rows, mutate })), new AbortController().signal)
    await face.load()
    await face.selectDefault('workspace-write')
    expect(mutate).toHaveBeenCalledWith(
      'permission', [{ op: 'set', path: ['defaultPreset'], value: 'workspace-write' }], 3,
    )
    expect(face.getSnapshot().currentValue).toBe('read-only')
  })

  it('surfaces a rejected write without claiming the new value', async () => {
    const mutate = vi.fn(async () => { throw new Error('native/settings-conflict') })
    const rows = [descriptor(['read-only', 'workspace-write'])]
    const face = createNativePermissionPresets(asClient(client({ rows, mutate })), new AbortController().signal)
    await face.load()
    await face.selectDefault('workspace-write')
    expect(face.getSnapshot().status).toBe('error')
    expect(face.getSnapshot().error).toBe('native/settings-conflict')
  })

  it('switches a Session through the Host without touching the default', async () => {
    const switchClient = client()
    const face = createNativePermissionPresets(asClient(switchClient), new AbortController().signal)
    await face.selectForSession(SID, 'workspace-write')
    expect(switchClient.selectPermissionPreset).toHaveBeenCalledWith(SID, 'workspace-write', expect.any(AbortSignal))
  })
})

describe('native permission row', () => {
  function mount(state: NativePermissionRowState) {
    const load = vi.fn(async () => {})
    const select = vi.fn(async () => {})
    const usePermission = (<T,>(selector: (value: NativePermissionRowState) => T): T =>
      useSyncExternalStore(() => () => {}, () => selector(state)))
    render(<NativePermissionRow usePermission={usePermission} load={load} select={select} t={t} />)
    return { load, select }
  }

  it('renders nothing when the namespace is unavailable', () => {
    const view = render(<div />)
    view.unmount()
    mount({ status: 'unavailable', error: null, writable: false, currentValue: '', options: [], revision: 0 })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('writes a harmless preset straight through', async () => {
    const { select } = mount({
      status: 'ready', error: null, writable: true, currentValue: 'read-only',
      options: [{ id: 'read-only', label: 'read-only' }, { id: 'workspace-write', label: 'workspace-write' }],
      revision: 3,
    })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.click(await screen.findByRole('menuitem', { name: zh['preset.workspaceWrite'] }))
    await waitFor(() => { expect(select).toHaveBeenCalledWith('workspace-write') })
  })

  it('gates Full access behind the shared risk confirmation', async () => {
    const { select } = mount({
      status: 'ready', error: null, writable: true, currentValue: 'read-only',
      options: [{ id: 'read-only', label: 'read-only' }, { id: FULL_ACCESS_PRESET, label: FULL_ACCESS_PRESET }],
      revision: 3,
    })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.click(await screen.findByRole('menuitem', { name: zh['preset.fullAccess'] }))
    // Picking the preset opens the gate; it does not write.
    await screen.findByText(zh['confirm.title'])
    expect(select).not.toHaveBeenCalled()
  })
})

describe('native permission dictionaries', () => {
  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
