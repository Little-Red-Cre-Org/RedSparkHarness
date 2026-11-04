/**
 * Native plugin inventory: the browser catalog's read port over the running
 * profile's installation rows.
 */
import { describe, expect, it, vi } from 'vitest'
import type { NativePluginInventory, NativePluginInventoryEntry } from '@redspark/rsh-client-native-session/native'
import { createInventoryPorts, installationPhase, toSnapshot } from '../src/native.ts'

/** Build one installation row with only the fields the adapter reads. */
function entry(over: Partial<NativePluginInventoryEntry> = {}): NativePluginInventoryEntry {
  return { id: 'entry', name: '@redspark/rsh-tool-fs', scope: 'root', state: 'ready', ...over }
}

describe('installationPhase', () => {
  it('maps every installation state onto the catalog phase vocabulary', () => {
    expect(installationPhase('planned')).toBe('pending')
    expect(installationPhase('activating')).toBe('loading')
    expect(installationPhase('ready')).toBe('active')
    expect(installationPhase('draining')).toBe('unloading')
    expect(installationPhase('failed')).toBe('failed')
    expect(installationPhase('disposed')).toBeNull()
  })
})

describe('toSnapshot', () => {
  it('projects installations into the global plane with names and ids intact', () => {
    const inventory: NativePluginInventory = {
      entries: [entry({ id: 'fs', name: '@redspark/rsh-tool-fs' }), entry({ id: 'bash', name: '@redspark/rsh-tool-bash', state: 'activating' })],
    }
    const snapshot = toSnapshot(inventory)
    expect(snapshot.entries.map(row => [row.entryId, row.moduleName, row.enabled, row.fiberPhase])).toEqual([
      ['fs', '@redspark/rsh-tool-fs', true, 'active'],
      ['bash', '@redspark/rsh-tool-bash', true, 'loading'],
    ])
  })

  it('reports a disposed installation as disabled and without a live fiber', () => {
    const snapshot = toSnapshot({ entries: [entry({ state: 'disposed' })] })
    expect(snapshot.entries[0]?.enabled).toBe(false)
    expect(snapshot.entries[0]?.fiberPhase).toBeNull()
  })

  it('carries no Agent-preset roster: the Native transport reports no such fact', () => {
    expect(toSnapshot({ entries: [entry()] }).agentPresets).toBeUndefined()
  })

  it('projects an empty inventory to an empty catalog', () => {
    expect(toSnapshot({ entries: [] })).toEqual({ entries: [] })
  })
})

describe('createInventoryPorts', () => {
  it('reads the installation inventory through the Native Session client', async () => {
    const list = vi.fn<() => Promise<NativePluginInventory>>()
      .mockResolvedValue({ entries: [entry({ id: 'fs' })] })
    const ports = createInventoryPorts({ pluginInventoryList: list })
    const snapshot = await ports.list()
    expect(list).toHaveBeenCalledTimes(1)
    expect(snapshot.entries.map(row => row.entryId)).toEqual(['fs'])
  })

  it('rejects when the Host read fails instead of reporting an empty catalog', async () => {
    const list = vi.fn<() => Promise<NativePluginInventory>>().mockRejectedValue(new Error('host unavailable'))
    const ports = createInventoryPorts({ pluginInventoryList: list })
    await expect(ports.list()).rejects.toThrow('host unavailable')
  })
})
