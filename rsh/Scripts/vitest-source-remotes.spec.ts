import { describe, expect, it } from 'vitest'
import { schedulerRemoteTestPlugin } from './test-scheduler-remote.ts'

describe('source-mode scheduler Remote replacement', () => {
  it('resolves the generated contribution to a source-independent virtual module', () => {
    const plugin = schedulerRemoteTestPlugin()
    const id = plugin.resolveId('@redspark/rsh-task-scheduler/remote')!
    expect(id.startsWith('\0')).toBe(true)
    expect(plugin.load(id)).toBe('export default { package: "@redspark/rsh-task-scheduler", descriptors: [] }')
  })

  it('leaves product modules and explicit built-artifact imports untouched', () => {
    const plugin = schedulerRemoteTestPlugin()
    for (const id of ['@redspark/rsh-task-scheduler/client', '@redspark/rsh-task-scheduler', '/repo/lib/typert.remote-client.js']) {
      expect(plugin.resolveId(id)).toBeUndefined()
      expect(plugin.load(id)).toBeUndefined()
    }
  })
})
