// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { assertServiceable, Config as PiAiConfig, resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai/src/config.ts'
import { NativeSettings, type NativeSettingsPathOp, type NativeSettingsSection } from '@deepseek-ai/dsh-settings/native'
import type { NativeSessionClient, NativeSettingsDescriptor } from '@deepseek-ai/dsh-client-native-session/native'
import { en } from '../src/locales.ts'
import { SettingsPage, nativeSettingsDiff } from '../src/settings-page.tsx'

afterEach(cleanup)

it('writes changed user fields without replacing a parent that contains a hidden secret', () => {
  expect(() => nativeSettingsDiff(
    { providers: { alpha: { label: 'old' } } },
    { providers: {} },
    [['providers', 'alpha', 'privateValue']],
  )).toThrow('hidden secret fields')
  expect(nativeSettingsDiff({ providers: {} }, { providers: { deepseek: {} } }, []))
    .toEqual([{ op: 'set', path: ['providers', 'deepseek'], value: {} }])
  expect(nativeSettingsDiff({ providers: { deepseek: {} } }, { providers: {} }, []))
    .toEqual([{ op: 'unset', path: ['providers', 'deepseek'] }])
  expect(nativeSettingsDiff({ providers: { deepseek: {} } }, { providers: 'disabled' }, []))
    .toEqual([{ op: 'set', path: ['providers'], value: 'disabled' }])
  expect(() => nativeSettingsDiff({ providers: { deepseek: {} } }, { providers: {} }, [['providers', 'deepseek', 'apiKey']]))
    .toThrow('hidden secret fields')
  expect(() => nativeSettingsDiff({ providers: { deepseek: {} } }, { providers: 'disabled' }, [['providers', 'deepseek', 'apiKey']]))
    .toThrow('hidden secret fields')
  expect(nativeSettingsDiff(
    { rows: [{ enabled: true }] },
    { rows: [{ enabled: false }] },
    [['rows', '0', 'privateValue']],
  )).toEqual([{ op: 'set', path: ['rows', '0', 'enabled'], value: false }])
  expect(() => nativeSettingsDiff({ rows: [{ enabled: true }] }, { rows: [] }, [['rows', '0', 'privateValue']]))
    .toThrow('existing row count and order')
  expect(() => nativeSettingsDiff(
    { rows: [{ label: 'first' }, { label: 'second' }] },
    { rows: [{ label: 'second' }, { label: 'first' }] },
    [['rows', '0', 'privateValue'], ['rows', '1', 'privateValue']],
  )).toThrow('existing row count and order')
})

it('persists serviceable object additions and removals through Settings and refreshes its canonical projection', async () => {
  let document: NativeSettingsSection = { 'llm-pi-ai': { providers: {} } }
  const settings = new NativeSettings({
    load: async () => document,
    persist: async (update) => { document = update(document); return document },
  })
  await settings.start()
  const validateWrite = vi.fn(assertServiceable)
  const owner = settings.register('llm-pi-ai', { providers: {} }, value => PiAiConfig(value), validateWrite,
    { schema: PiAiConfig, applies: 'live' })
  const settingsMutate = vi.fn(async (namespace: string, ops: readonly NativeSettingsPathOp[], revision: number) => {
    await settings.mutate(namespace, ops, revision)
    const descriptor = settings.describe().find(candidate => candidate.namespace === namespace)
    if (descriptor === undefined) throw new Error('missing native Settings descriptor after mutation')
    return descriptor
  })
  const client = {
    settingsDescribe: vi.fn(async () => settings.describe()), settingsMutate,
    credentialsDescribe: vi.fn(async () => ({})),
  } as unknown as NativeSessionClient

  try {
    render(<SettingsPage client={client} t={key => en[key]} onBack={() => undefined} />)
    await screen.findByRole('heading', { name: 'llm-pi-ai' })
    const editor = screen.getByLabelText('User overrides (JSON) llm-pi-ai') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: JSON.stringify({ providers: { deepseek: {} } }, null, 2) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => { expect(settingsMutate).toHaveBeenCalledOnce() })
    await waitFor(() => { expect(JSON.parse(editor.value)).toEqual({ providers: { deepseek: {} } }) })
    expect(settingsMutate.mock.calls[0]?.[1]).toEqual([{ op: 'set', path: ['providers', 'deepseek'], value: {} }])
    expect(screen.getByText(en.settingsSaved)).toBeTruthy()
    expect(validateWrite).toHaveBeenCalledOnce()
    expect(Object.isFrozen(owner.get())).toBe(true)
    expect(resolveProfiles(owner.get().providers).has('deepseek')).toBe(true)

    fireEvent.change(editor, { target: { value: JSON.stringify({ providers: {} }, null, 2) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => { expect(settingsMutate).toHaveBeenCalledTimes(2) })
    await waitFor(() => { expect(JSON.parse(editor.value)).toEqual({ providers: {} }) })
    expect(settingsMutate.mock.calls[1]?.[1]).toEqual([{ op: 'unset', path: ['providers', 'deepseek'] }])
    expect(validateWrite).toHaveBeenCalledTimes(2)
    expect(resolveProfiles(owner.get().providers).has('deepseek')).toBe(false)
    expect(screen.getByText(en.settingsSaved)).toBeTruthy()
  } finally { await settings.dispose() }
})

it('renders schema-discovered credential references and clears the write-only value after storage', async () => {
  const row: NativeSettingsDescriptor = {
    namespace: 'llm-pi-ai', schema: {}, value: {}, base: {}, user: {}, applies: 'live', secrets: [],
    credentialRefs: ['DEEPSEEK_API_KEY'], revision: 4,
  }
  const credentialsSet = vi.fn(async () => undefined)
  const client = {
    settingsDescribe: vi.fn(async () => [row]),
    settingsMutate: vi.fn(),
    credentialsDescribe: vi.fn(async () => ({ DEEPSEEK_API_KEY: { configured: false, writable: true } })),
    credentialsSet,
    credentialsUnset: vi.fn(async () => undefined),
  } as unknown as NativeSessionClient
  render(<SettingsPage client={client} t={key => en[key]} onBack={() => undefined} />)

  expect(await screen.findByRole('heading', { name: 'llm-pi-ai' })).toBeTruthy()
  const input = screen.getByLabelText('New credential value DEEPSEEK_API_KEY') as HTMLInputElement
  fireEvent.change(input, { target: { value: 'native-rpc-secret' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save credential' }))

  await waitFor(() => { expect(credentialsSet).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'native-rpc-secret') })
  await waitFor(() => { expect(input.value).toBe('') })
  expect(document.body.textContent).not.toContain('native-rpc-secret')
})

it('saves a visible array field through its existing index while preserving the hidden sibling', async () => {
  let enabled = true
  let revision = 2
  const row = (): NativeSettingsDescriptor => ({
    namespace: 'profiles', schema: {}, value: {}, base: {}, user: { rows: [{ enabled }] }, applies: 'live',
    secrets: [{ path: ['rows', '0', 'privateValue'], set: true }], credentialRefs: [], revision,
  })
  const settingsMutate = vi.fn(async (_namespace: string, ops: readonly unknown[], expected: number) => {
    expect(expected).toBe(revision)
    expect(ops).toEqual([{ op: 'set', path: ['rows', '0', 'enabled'], value: false }])
    enabled = false
    revision += 1
    return row()
  })
  const client = {
    settingsDescribe: vi.fn(async () => [row()]),
    settingsMutate,
    credentialsDescribe: vi.fn(async () => ({})),
  } as unknown as NativeSessionClient
  render(<SettingsPage client={client} t={key => en[key]} onBack={() => undefined} />)
  await screen.findByRole('heading', { name: 'profiles' })
  fireEvent.change(screen.getByLabelText('User overrides (JSON) profiles'), {
    target: { value: JSON.stringify({ rows: [{ enabled: false }] }) },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
  await waitFor(() => { expect(settingsMutate).toHaveBeenCalledOnce() })
  expect(await screen.findByText(en.settingsSaved)).toBeTruthy()
})

it('reports unsupported array and hidden-secret structure edits instead of silently reporting a save', async () => {
  const row: NativeSettingsDescriptor = {
    namespace: 'profiles', schema: {}, value: {}, base: {},
    user: { rows: [{ enabled: true }], providers: { alpha: { label: 'Alpha' } } }, applies: 'live',
    secrets: [{ path: ['rows', '0', 'privateValue'], set: true }, { path: ['providers', 'alpha', 'privateValue'], set: true }],
    credentialRefs: [], revision: 0,
  }
  const settingsMutate = vi.fn()
  const client = {
    settingsDescribe: vi.fn(async () => [row]),
    settingsMutate,
    credentialsDescribe: vi.fn(async () => ({})),
  } as unknown as NativeSessionClient
  render(<SettingsPage client={client} t={key => en[key]} onBack={() => undefined} />)
  await screen.findByRole('heading', { name: 'profiles' })
  fireEvent.change(screen.getByLabelText('User overrides (JSON) profiles'), { target: { value: JSON.stringify({ rows: [] }) } })
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
  expect((await screen.findByRole('alert')).textContent).toContain(en.settingsArrayStructureUnsupported)
  expect(settingsMutate).not.toHaveBeenCalled()
  expect(screen.queryByText(en.settingsSaved)).toBeNull()

  fireEvent.change(screen.getByLabelText('User overrides (JSON) profiles'), {
    target: { value: JSON.stringify({ rows: [{ enabled: true }], providers: {} }) },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
  expect((await screen.findByRole('alert')).textContent).toContain(en.settingsSecretStructureUnsupported)
  expect(settingsMutate).not.toHaveBeenCalled()
  expect(screen.queryByText(en.settingsSaved)).toBeNull()
})
