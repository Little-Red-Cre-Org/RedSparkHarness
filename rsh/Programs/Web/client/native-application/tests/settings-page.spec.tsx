// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { NativeSessionClient, NativeSettingsDescriptor } from '@deepseek-ai/dsh-client-native-session/native'
import { en } from '../src/locales.ts'
import { SettingsPage, nativeSettingsDiff } from '../src/settings-page.tsx'

afterEach(cleanup)

it('writes changed user fields without replacing a parent that contains a hidden secret', () => {
  const operations = nativeSettingsDiff(
    { providers: { alpha: { label: 'old' } } },
    { providers: {} },
    [['providers', 'alpha', 'privateValue']],
  )
  expect(operations).toEqual([{ op: 'unset', path: ['providers', 'alpha', 'label'] }])
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

it('reports unsupported array resizing instead of silently reporting a save', async () => {
  const row: NativeSettingsDescriptor = {
    namespace: 'profiles', schema: {}, value: {}, base: {}, user: { rows: [{ enabled: true }] }, applies: 'live',
    secrets: [{ path: ['rows', '0', 'privateValue'], set: true }], credentialRefs: [], revision: 0,
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
})
