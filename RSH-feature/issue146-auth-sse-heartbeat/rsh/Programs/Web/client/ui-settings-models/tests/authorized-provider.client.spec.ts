import { describe, expect, it, vi } from 'vitest'
import { enableAuthorizedProvider } from '../src/client/authorized-provider.ts'
import { en } from '../src/client/locales.ts'
import type { ModelsOperations } from '../src/client/operations.ts'
import type { ModelsSettingsState, ModelsSettingsStore } from '../src/client/store.ts'

const key = 'llm-pi-ai/openai-codex' as never
const t = (name: keyof typeof en): string => en[name]

function setup() {
  const state: ModelsSettingsState = {
    status: 'ready', error: null, credentialError: null, writable: true,
    rows: [{
      entry: { provider: 'openai-codex', displayName: 'OpenAI Codex', settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', 'openai-codex'], active: false },
      configured: false, removable: false, apiKeyEnv: undefined, credential: undefined,
    }],
    namespaces: new Map([['llm-pi-ai', {
      ns: 'llm-pi-ai', schema: {}, value: { providers: {} }, user: {}, base: {},
      applies: 'live', secrets: [], revision: 7,
    }]]),
  }
  const load = vi.fn().mockResolvedValue(undefined)
  const controller = { load, store: { getSnapshot: () => state } } as unknown as ModelsSettingsStore
  const writeSettings = vi.fn().mockImplementation(() => {
    state.rows[0]!.entry = { ...state.rows[0]!.entry, active: true }
    return Promise.resolve({ kind: 'written', view: state.namespaces.get('llm-pi-ai') })
  })
  const operations = { writeSettings } as unknown as ModelsOperations
  return { state, controller, operations, load, writeSettings }
}

describe('signed-in Codex route activation', () => {
  it('does not write when the panel closes while the directory is loading', async () => {
    const h = setup()
    const lifetime = new AbortController()
    h.load.mockImplementation(() => { lifetime.abort(); return Promise.resolve() })
    await expect(enableAuthorizedProvider(key, h.operations, h.controller, t, lifetime.signal)).rejects.toThrow()
    expect(h.writeSettings).not.toHaveBeenCalled()
  })

  it('adds only the absent route with no API-key reference, fenced by the settings revision', async () => {
    const h = setup()
    await enableAuthorizedProvider(key, h.operations, h.controller, t)
    expect(h.writeSettings).toHaveBeenCalledExactlyOnceWith('llm-pi-ai', [
      { op: 'set', path: ['providers', 'openai-codex'], value: {} },
    ], 7)
    expect(h.load).toHaveBeenCalledTimes(2)
  })

  it('preserves an existing profile even when settings are read-only', async () => {
    const h = setup()
    h.state.rows[0]!.configured = true
    h.state.rows[0]!.entry = { ...h.state.rows[0]!.entry, active: true }
    h.state.writable = false
    await enableAuthorizedProvider(key, h.operations, h.controller, t)
    expect(h.writeSettings).not.toHaveBeenCalled()
  })

  it('refuses to replace an explicit API-key reference with account authentication', async () => {
    const h = setup()
    h.state.rows[0]!.apiKeyEnv = 'EXISTING_KEY'
    await expect(enableAuthorizedProvider(key, h.operations, h.controller, t)).rejects.toThrow(en.authorizationApiKeyOverride)
    expect(h.writeSettings).not.toHaveBeenCalled()
  })

  it.each(['conflict', 'refused'])('reports a %s without retrying over another writer', async (kind) => {
    const h = setup()
    h.writeSettings.mockResolvedValue({ kind, message: 'settings changed' })
    await expect(enableAuthorizedProvider(key, h.operations, h.controller, t)).rejects.toThrow('settings changed')
    expect(h.writeSettings).toHaveBeenCalledOnce()
  })

  it('reports unavailable and read-only settings before writing', async () => {
    const h = setup()
    h.state.writable = false
    await expect(enableAuthorizedProvider(key, h.operations, h.controller, t)).rejects.toThrow(en.readOnly)
    h.state.status = 'error'
    h.state.error = 'Host disconnected'
    await expect(enableAuthorizedProvider(key, h.operations, h.controller, t)).rejects.toThrow('Host disconnected')
    expect(h.writeSettings).not.toHaveBeenCalled()
  })

  it('does not report model activation when registration failed after saving', async () => {
    const h = setup()
    h.writeSettings.mockResolvedValue({ kind: 'written', view: h.state.namespaces.get('llm-pi-ai') })
    await expect(enableAuthorizedProvider(key, h.operations, h.controller, t)).rejects.toThrow(en.authorizationProviderMissing)
  })

  it('does not infer provider routes from other authorization keys', async () => {
    const h = setup()
    await enableAuthorizedProvider('other/account' as never, h.operations, h.controller, t)
    expect(h.writeSettings).not.toHaveBeenCalled()
  })
})
