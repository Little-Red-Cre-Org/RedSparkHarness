// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { assertServiceable, Config as PiAiConfig, resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai/src/config.ts'
import { NativeSettings, type NativeSettingsDescriptor as ServiceNativeSettingsDescriptor,
  type NativeSettingsPathOp, type NativeSettingsSection } from '@deepseek-ai/dsh-settings/native'
import { credentialKey, type NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import { NativeScope, RuntimeEvents } from '@deepseek-ai/dsh-native-runtime'
import { NativeAuthorizationProvider, type AuthorizationPromptId } from '@deepseek-ai/dsh-authorization/native'
import type { NativeSessionClient, NativeSettingsDescriptor } from '@deepseek-ai/dsh-client-native-session/native'
import { en, zh } from '../src/locales.ts'
import { SettingsPage, nativeSettingsDiff, type NativeSettingsActions } from '../src/settings-page.tsx'

afterEach(cleanup)

const locales = [{ language: 'en', strings: en }, { language: 'zh', strings: zh }] as const
const defaultLimits = { maxCredentialRefsPerRead: 64, maxSettingsOperations: 512 }
const settingsDescription = (
  namespaces: readonly (NativeSettingsDescriptor | ServiceNativeSettingsDescriptor)[], limits = defaultLimits,
) => ({ namespaces, limits })

async function expectSettingsOutput(name: string, language: string): Promise<void> {
  const output = {
    headings: screen.getAllByRole('heading').map(element => element.textContent),
    buttons: screen.getAllByRole('button').map(element => element.textContent?.trim()),
    labels: [...document.querySelectorAll('label')].map(element => element.textContent?.replace(/\s+/g, ' ').trim()),
    alerts: screen.queryAllByRole('alert').map(element => element.textContent?.trim()),
    notices: screen.queryAllByRole('status').map(element => element.textContent?.trim()),
  }
  await expect(JSON.stringify(output, null, 2)).toMatchFileSnapshot(`./expected/settings-page-${name}.${language}.txt`)
}

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

it.each(locales)('persists serviceable edits and refreshes the canonical projection ($language)', async ({ language, strings }) => {
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
    settingsDescribe: vi.fn(async () => settingsDescription(settings.describe())), settingsMutate,
    credentialsDescribe: vi.fn(async () => ({})), authorizationList: vi.fn(async () => []),
  } as unknown as NativeSessionClient

  try {
    render(<SettingsPage actions={client} t={key => strings[key]} onBack={() => undefined} />)
    await screen.findByRole('heading', { name: 'llm-pi-ai' })
    const editor = screen.getByLabelText(`${strings.userOverrides} llm-pi-ai`) as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: JSON.stringify({ providers: { deepseek: {} } }, null, 2) } })
    fireEvent.click(screen.getByRole('button', { name: strings.saveSettings }))
    await waitFor(() => { expect(settingsMutate).toHaveBeenCalledOnce() })
    await waitFor(() => { expect(JSON.parse(editor.value)).toEqual({ providers: { deepseek: {} } }) })
    expect(settingsMutate.mock.calls[0]?.[1]).toEqual([{ op: 'set', path: ['providers', 'deepseek'], value: {} }])
    expect(screen.getByText(strings.settingsSaved)).toBeTruthy()
    expect(validateWrite).toHaveBeenCalledOnce()
    expect(Object.isFrozen(owner.get())).toBe(true)
    expect(resolveProfiles(owner.get().providers).has('deepseek')).toBe(true)

    fireEvent.change(editor, { target: { value: JSON.stringify({ providers: {} }, null, 2) } })
    fireEvent.click(screen.getByRole('button', { name: strings.saveSettings }))
    await waitFor(() => { expect(settingsMutate).toHaveBeenCalledTimes(2) })
    await waitFor(() => { expect(JSON.parse(editor.value)).toEqual({ providers: {} }) })
    expect(settingsMutate.mock.calls[1]?.[1]).toEqual([{ op: 'unset', path: ['providers', 'deepseek'] }])
    expect(validateWrite).toHaveBeenCalledTimes(2)
    expect(resolveProfiles(owner.get().providers).has('deepseek')).toBe(false)
    expect(screen.getByText(strings.settingsSaved)).toBeTruthy()
    await expectSettingsOutput('edit-refresh', language)
  } finally { await settings.dispose() }
})

it.each(locales)('renders write-only credentials and clears the value after storage ($language)', async ({ language, strings }) => {
  const row: NativeSettingsDescriptor = {
    namespace: 'llm-pi-ai', schema: {}, value: {}, base: {}, user: {}, applies: 'live', secrets: [],
    credentialRefs: ['DEEPSEEK_API_KEY'], revision: 4,
  }
  const credentialsSet = vi.fn(async () => undefined)
  const client = {
    settingsDescribe: vi.fn(async () => settingsDescription([row])),
    settingsMutate: vi.fn(),
    credentialsDescribe: vi.fn(async () => ({ DEEPSEEK_API_KEY: { configured: false, writable: true } })),
    authorizationList: vi.fn(async () => []),
    credentialsSet,
    credentialsUnset: vi.fn(async () => undefined),
  } as unknown as NativeSessionClient
  render(<SettingsPage actions={client} t={key => strings[key]} onBack={() => undefined} />)

  expect(await screen.findByRole('heading', { name: 'llm-pi-ai' })).toBeTruthy()
  const input = screen.getByLabelText(`${strings.credentialValue} DEEPSEEK_API_KEY`) as HTMLInputElement
  fireEvent.change(input, { target: { value: 'native-rpc-secret' } })
  fireEvent.click(screen.getByRole('button', { name: strings.saveCredential }))

  await waitFor(() => { expect(credentialsSet).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'native-rpc-secret') })
  await waitFor(() => { expect(input.value).toBe('') })
  expect(document.body.textContent).not.toContain('native-rpc-secret')
  await expectSettingsOutput('write-only-credential', language)
})

it.each(locales)('saves a visible array field through its existing index ($language)', async ({ strings }) => {
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
    settingsDescribe: vi.fn(async () => settingsDescription([row()])),
    settingsMutate,
    credentialsDescribe: vi.fn(async () => ({})), authorizationList: vi.fn(async () => []),
  } as unknown as NativeSessionClient
  render(<SettingsPage actions={client} t={key => strings[key]} onBack={() => undefined} />)
  await screen.findByRole('heading', { name: 'profiles' })
  fireEvent.change(screen.getByLabelText(`${strings.userOverrides} profiles`), {
    target: { value: JSON.stringify({ rows: [{ enabled: false }] }) },
  })
  fireEvent.click(screen.getByRole('button', { name: strings.saveSettings }))
  await waitFor(() => { expect(settingsMutate).toHaveBeenCalledOnce() })
  expect(await screen.findByText(strings.settingsSaved)).toBeTruthy()
})

it.each(locales)('reports unsupported structure edits instead of reporting a save ($language)', async ({ language, strings }) => {
  const row: NativeSettingsDescriptor = {
    namespace: 'profiles', schema: {}, value: {}, base: {},
    user: { rows: [{ enabled: true }], providers: { alpha: { label: 'Alpha' } } }, applies: 'live',
    secrets: [{ path: ['rows', '0', 'privateValue'], set: true }, { path: ['providers', 'alpha', 'privateValue'], set: true }],
    credentialRefs: [], revision: 0,
  }
  const settingsMutate = vi.fn()
  const client = {
    settingsDescribe: vi.fn(async () => settingsDescription([row])),
    settingsMutate,
    credentialsDescribe: vi.fn(async () => ({})), authorizationList: vi.fn(async () => []),
  } as unknown as NativeSessionClient
  render(<SettingsPage actions={client} t={key => strings[key]} onBack={() => undefined} />)
  await screen.findByRole('heading', { name: 'profiles' })
  fireEvent.change(screen.getByLabelText(`${strings.userOverrides} profiles`), { target: { value: JSON.stringify({ rows: [] }) } })
  fireEvent.click(screen.getByRole('button', { name: strings.saveSettings }))
  expect((await screen.findByRole('alert')).textContent).toContain(strings.settingsArrayStructureUnsupported)
  await expectSettingsOutput('array-structure-refusal', language)
  expect(settingsMutate).not.toHaveBeenCalled()
  expect(screen.queryByText(strings.settingsSaved)).toBeNull()

  fireEvent.change(screen.getByLabelText(`${strings.userOverrides} profiles`), {
    target: { value: JSON.stringify({ rows: [{ enabled: true }], providers: {} }) },
  })
  fireEvent.click(screen.getByRole('button', { name: strings.saveSettings }))
  expect((await screen.findByRole('alert')).textContent).toContain(strings.settingsSecretStructureUnsupported)
  await expectSettingsOutput('secret-structure-refusal', language)
  expect(settingsMutate).not.toHaveBeenCalled()
  expect(screen.queryByText(strings.settingsSaved)).toBeNull()
})

it.each(locales)('aggregates credential reads above the advertised per-request budget ($language)', async ({ strings }) => {
  const refs = Array.from({ length: 65 }, (_, index) => `NATIVE_TEST_KEY_${index}`)
  const row: NativeSettingsDescriptor = {
    namespace: 'credentials', schema: {}, value: {}, base: {}, user: {}, applies: 'live', secrets: [],
    credentialRefs: refs, revision: 0,
  }
  const credentialsDescribe = vi.fn(async (batch: readonly string[]) => {
    expect(batch.length).toBeLessThanOrEqual(64)
    return Object.fromEntries(batch.map(ref => [ref, { configured: ref === refs[64], writable: true }]))
  })
  const client = {
    settingsDescribe: vi.fn(async () => settingsDescription([row])),
    settingsMutate: vi.fn(), credentialsDescribe, authorizationList: vi.fn(async () => []),
  } as unknown as NativeSessionClient
  render(<SettingsPage actions={client} t={key => strings[key]} onBack={() => undefined} />)
  await screen.findByRole('heading', { name: 'credentials' })
  await waitFor(() => { expect(credentialsDescribe).toHaveBeenCalledTimes(2) })
  expect(credentialsDescribe.mock.calls.map(([batch]) => batch)).toEqual([refs.slice(0, 64), refs.slice(64)])
  expect(screen.getByRole('button', { name: strings.removeCredential })).toBeTruthy()
  expect(screen.queryByText(`${strings.credentialError}:`)).toBeNull()
})

it.each(locales)('refuses edits above the advertised atomic operation budget ($language)', async ({ strings }) => {
  const row: NativeSettingsDescriptor = {
    namespace: 'bounded', schema: {}, value: {}, base: {}, user: { first: false, second: false }, applies: 'live',
    secrets: [], credentialRefs: [], revision: 8,
  }
  const settingsMutate = vi.fn()
  const client = {
    settingsDescribe: vi.fn(async () => settingsDescription([row], { maxCredentialRefsPerRead: 64, maxSettingsOperations: 1 })),
    settingsMutate, credentialsDescribe: vi.fn(async () => ({})), authorizationList: vi.fn(async () => []),
  } as unknown as NativeSessionClient
  render(<SettingsPage actions={client} t={key => strings[key]} onBack={() => undefined} />)
  await screen.findByRole('heading', { name: 'bounded' })
  fireEvent.change(screen.getByLabelText(`${strings.userOverrides} bounded`), {
    target: { value: JSON.stringify({ first: true, second: true }) },
  })
  fireEvent.click(screen.getByRole('button', { name: strings.saveSettings }))
  expect((await screen.findByRole('alert')).textContent).toContain(strings.settingsOperationLimitExceeded)
  expect(settingsMutate).not.toHaveBeenCalled()
})

it('refresh mid-login then resume and finish', async () => {
  const key = credentialKey('llm-pi-ai', 'openai-codex')
  const scope = new NativeScope()
  const events = new RuntimeEvents()
  let configured = false
  let answer: string | undefined
  const credentials = {
    describeRecord: vi.fn(async () => ({ configured, writable: true })),
  } as unknown as NativeCredentials
  const authorization = new NativeAuthorizationProvider(scope, credentials, { events })
  authorization.registerFlow({
    key,
    label: 'OpenAI Codex',
    methods: [{ id: 'oauth', label: 'OAuth' }],
    async run(session) {
      session.notify({ message: 'Open the authorization page', url: 'https://auth.example/device', code: 'ABCD-1234' })
      answer = await session.prompt({ kind: 'secret', message: 'Authorization code' })
      configured = true
      authorization.recordUpdated(key)
    },
  })
  const cancel = vi.fn(async (attemptId: string) => {
    const attempt = authorization.current(key)
    if (attempt?.id === attemptId) await attempt.cancel()
  })
  const actions = {
    settingsDescribe: vi.fn(async () => settingsDescription([])),
    authorizationList: vi.fn(async () => Promise.all(authorization.list().map(async (entry) => {
      const record = await credentials.describeRecord(key)
      const attemptId = authorization.current(key)?.id
      return { key: entry.key, label: entry.label, methods: entry.methods, configured: record.configured,
        writable: record.writable, ...(attemptId === undefined ? {} : { attemptId }) }
    }))),
    authorizationBegin: vi.fn(async () => ({ attemptId: authorization.begin({ key }).id })),
    authorizationFrames: vi.fn((frameKey: string, attemptId: string, signal: AbortSignal) => {
      const attempt = authorization.current(key)
      if (frameKey !== key || attempt?.id !== attemptId) throw new Error('missing authorization attempt')
      return attempt.frames(signal)
    }),
    authorizationAnswer: vi.fn(async (_key: string, attemptId: string, promptId: string, value: string) => {
      const attempt = authorization.current(key)
      if (attempt?.id !== attemptId) throw new Error('missing authorization attempt')
      attempt.answer(promptId as AuthorizationPromptId, value)
    }),
    authorizationCancel: vi.fn(async (_key: string, attemptId: string) => cancel(attemptId)),
  } as unknown as NativeSettingsActions
  const onAuthorized = vi.fn()
  const props = { actions, t: (localeKey: keyof typeof en) => en[localeKey], onBack: () => undefined, onAuthorized }

  try {
    const firstPage = render(<SettingsPage {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: en.signIn }))
    expect(await screen.findByRole('link', { name: 'https://auth.example/device' })).toBeTruthy()
    expect(await screen.findByText('ABCD-1234')).toBeTruthy()
    await screen.findByLabelText('Authorization code')

    firstPage.unmount()
    expect(authorization.current(key)).toBeDefined()
    expect(cancel).not.toHaveBeenCalled()

    render(<SettingsPage {...props} />)
    expect(await screen.findByRole('link', { name: 'https://auth.example/device' })).toBeTruthy()
    const input = await screen.findByLabelText('Authorization code')
    fireEvent.change(input, { target: { value: 'secret-answer' } })
    fireEvent.click(screen.getByRole('button', { name: en.authorizationAnswer }))
    expect(await screen.findByText(en.authorizationAuthorized)).toBeTruthy()
    await waitFor(() => { expect(onAuthorized).toHaveBeenCalledOnce() })
    await waitFor(() => { expect(authorization.current(key)).toBeUndefined() })
    expect(answer).toBe('secret-answer')
    expect(cancel).not.toHaveBeenCalled()
  } finally { await authorization.dispose() }
})
