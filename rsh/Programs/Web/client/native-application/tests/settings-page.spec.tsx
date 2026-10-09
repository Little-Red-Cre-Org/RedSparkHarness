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

it.each([
  { name: 'settled before subscribe', attemptId: undefined },
  { name: 'same id resubscribes once, then stops', attemptId: 'a1' },
])('$name', async ({ attemptId }) => {
  const key = credentialKey('llm-pi-ai', 'openai-codex')
  const authorizationList = vi.fn(async () => [{ key, label: 'OpenAI Codex', methods: [{ id: 'oauth', label: 'OAuth' }],
    configured: false, writable: true, ...(attemptId === undefined ? {} : { attemptId }) }])
  const authorizationCancel = vi.fn(async () => undefined)
  let releaseSecond!: () => void
  const dropSecond = new Promise<void>((resolve) => { releaseSecond = resolve })
  const authorizationFrames = vi.fn(async function* (_key: string, _attemptId: string, signal: AbortSignal) {
    const call = authorizationFrames.mock.calls.length
    if (attemptId === undefined || call === 1) throw new Error('HTTP 409: unavailable attempt')
    yield { type: 'prompt', promptId: 'p1', prompt: { kind: 'text', message: 'Code' } } as const
    if (call === 2) {
      await dropSecond
      throw new Error('HTTP 409: unavailable attempt')
    }
    await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }) })
  })
  const actions = {
    settingsDescribe: vi.fn(async () => settingsDescription([])),
    settingsMutate: vi.fn(), credentialsDescribe: vi.fn(async () => ({})),
    credentialsSet: vi.fn(), credentialsUnset: vi.fn(), authorizationList,
    authorizationBegin: vi.fn(async () => ({ attemptId: 'a1' })), authorizationFrames,
    authorizationAnswer: vi.fn(), authorizationDecline: vi.fn(), authorizationCancel,
  } as unknown as NativeSettingsActions
  const onAuthorized = vi.fn(() => { throw new Error('native conversation: operation already pending') })
  const page = render(<SettingsPage actions={actions} t={localeKey => en[localeKey]} onBack={() => undefined}
    onAuthorized={onAuthorized} />)

  if (attemptId === undefined) {
    fireEvent.click(await screen.findByRole('button', { name: en.signIn }))
    expect(await screen.findByText(en.signInIncomplete)).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.cancelSignIn })).toBeNull()
  } else {
    expect(await screen.findByRole('textbox', { name: 'Code' })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.cancelSignIn })).toBeTruthy()
    expect(screen.queryByText(en.signInIncomplete)).toBeNull()
    expect(authorizationFrames).toHaveBeenCalledTimes(2)
    releaseSecond()
    expect(await screen.findByText(en.authorizationDisconnected)).toBeTruthy()
    expect(authorizationFrames).toHaveBeenCalledTimes(2)
    await new Promise<void>((resolve) => { setTimeout(() => { resolve() }, 20) })
    expect(authorizationFrames).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(en.signInIncomplete)).toBeNull()
  }
  expect(authorizationList).toHaveBeenCalledTimes(2)
  expect(onAuthorized).toHaveBeenCalledOnce()
  expect(authorizationCancel).not.toHaveBeenCalled()
  if (attemptId !== undefined) {
    fireEvent.click(screen.getByRole('button', { name: en.refreshSettings }))
    expect(await screen.findByRole('textbox', { name: 'Code' })).toBeTruthy()
    expect(screen.queryByText(en.authorizationDisconnected)).toBeNull()
    expect(authorizationFrames).toHaveBeenCalledTimes(3)
  }
  page.unmount()
})

it('a stale settings refresh cannot overwrite a newer one', async () => {
  const key = credentialKey('llm-pi-ai', 'openai-codex')
  let releaseStale!: () => void
  const staleGate = new Promise<void>((resolve) => { releaseStale = resolve })
  const credentialsDescribe = vi.fn(async () => {
    if (credentialsDescribe.mock.calls.length === 1) {
      await staleGate
      return { DEEPSEEK_API_KEY: { configured: false, writable: true } }
    }
    return { DEEPSEEK_API_KEY: { configured: true, writable: true } }
  })
  const row: NativeSettingsDescriptor = {
    namespace: 'llm-pi-ai', schema: {}, value: {}, base: {}, user: {}, applies: 'live', secrets: [],
    credentialRefs: ['DEEPSEEK_API_KEY'], revision: 1,
  }
  const actions = {
    settingsDescribe: vi.fn(async () => settingsDescription([row])),
    settingsMutate: vi.fn(), credentialsDescribe, credentialsSet: vi.fn(), credentialsUnset: vi.fn(),
    authorizationList: vi.fn(async () => [{
      key, label: 'OpenAI Codex', methods: [{ id: 'oauth', label: 'OAuth' }], configured: false, writable: true, attemptId: 'a1',
    }]),
    authorizationBegin: vi.fn(), authorizationAnswer: vi.fn(), authorizationDecline: vi.fn(), authorizationCancel: vi.fn(),
    authorizationFrames: vi.fn(async function* () { throw new Error('HTTP 409: unavailable attempt') }),
  } as unknown as NativeSettingsActions
  const page = render(<SettingsPage actions={actions} t={localeKey => en[localeKey]} onBack={() => undefined} />)
  const credential = () => screen.getByRole('form', { name: `${en.credential} DEEPSEEK_API_KEY` }).textContent ?? ''
  await waitFor(() => { expect(credentialsDescribe).toHaveBeenCalledTimes(2) })
  await waitFor(() => { expect(credential()).toContain(`· ${en.configured}`) })
  releaseStale()
  await new Promise<void>((resolve) => { setTimeout(() => { resolve() }, 20) })
  expect(credential()).toContain(`· ${en.configured}`)
  expect(screen.queryByText(en.loadingSettings)).toBeNull()
  page.unmount()

  let listAttempt = 'a1'
  let releaseCancel!: () => void
  const cancelGate = new Promise<void>((resolve) => { releaseCancel = resolve })
  let releaseSettle!: () => void
  const settleGate = new Promise<void>((resolve) => { releaseSettle = resolve })
  const authorizationFrames = vi.fn(async function* (_key: string, id: string, signal: AbortSignal) {
    yield { type: 'prompt', promptId: 'p1', prompt: { kind: 'secret', message: 'Code' } } as const
    if (id === 'a1') {
      await settleGate
      yield { type: 'settled', settlement: 'cancelled' } as const
      return
    }
    await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }) })
  })
  const resume = {
    settingsDescribe: vi.fn(async () => settingsDescription([])),
    settingsMutate: vi.fn(), credentialsDescribe: vi.fn(async () => ({})), credentialsSet: vi.fn(), credentialsUnset: vi.fn(),
    authorizationList: vi.fn(async () => [{
      key, label: 'OpenAI Codex', methods: [{ id: 'oauth', label: 'OAuth' }], configured: false, writable: true,
      attemptId: listAttempt,
    }]),
    authorizationBegin: vi.fn(), authorizationAnswer: vi.fn(), authorizationDecline: vi.fn(),
    authorizationFrames, authorizationCancel: vi.fn(async () => { await cancelGate }),
  } as unknown as NativeSettingsActions
  const next = render(<SettingsPage actions={resume} t={localeKey => en[localeKey]} onBack={() => undefined} />)
  fireEvent.change(await screen.findByLabelText('Code'), { target: { value: 'first-secret' } })
  fireEvent.click(screen.getByRole('button', { name: en.cancelSignIn }))
  listAttempt = 'a2'
  releaseSettle()
  await waitFor(() => { expect(authorizationFrames.mock.calls.some(call => call[1] === 'a2')).toBe(true) })
  fireEvent.change(await screen.findByLabelText('Code'), { target: { value: 'keep-me' } })
  releaseCancel()
  await new Promise<void>((resolve) => { setTimeout(() => { resolve() }, 20) })
  expect(screen.getByLabelText<HTMLInputElement>('Code').value).toBe('keep-me')
  next.unmount()
})

it('preserves a draft reset when a newer refresh replaces it', async () => {
  let user = { label: 'old' }
  let revision = 1
  let releaseSlow!: () => void
  const slow = new Promise<void>((resolve) => { releaseSlow = resolve })
  const row = (): NativeSettingsDescriptor => ({
    namespace: 'llm-pi-ai', schema: {}, value: {}, base: {}, user, applies: 'live', secrets: [],
    credentialRefs: [], revision,
  })
  const settingsDescribe = vi.fn(async () => {
    if (settingsDescribe.mock.calls.length === 2) await slow
    return settingsDescription([row()])
  })
  const settingsMutate = vi.fn(async () => {
    user = { label: 'canonical' }
    revision = 2
    return row()
  })
  const key = credentialKey('llm-pi-ai', 'openai-codex')
  let releaseSettle!: () => void
  const settleGate = new Promise<void>((resolve) => { releaseSettle = resolve })
  const actions = {
    settingsDescribe, settingsMutate,
    credentialsDescribe: vi.fn(async () => ({})), credentialsSet: vi.fn(), credentialsUnset: vi.fn(),
    authorizationList: vi.fn(async () => [{
      key, label: 'OpenAI Codex', methods: [{ id: 'oauth', label: 'OAuth' }], configured: false, writable: true, attemptId: 'a1',
    }]),
    authorizationBegin: vi.fn(), authorizationAnswer: vi.fn(), authorizationDecline: vi.fn(), authorizationCancel: vi.fn(),
    authorizationFrames: vi.fn(async function* () {
      await settleGate
      yield { type: 'settled', settlement: 'authorized' } as const
    }),
  } as unknown as NativeSettingsActions
  render(<SettingsPage actions={actions} t={localeKey => en[localeKey]} onBack={() => undefined} />)
  const editor = await screen.findByLabelText(`${en.userOverrides} llm-pi-ai`) as HTMLTextAreaElement
  fireEvent.change(editor, { target: { value: '{ "label": "stale" }' } })
  fireEvent.click(screen.getByRole('button', { name: en.saveSettings }))
  await waitFor(() => { expect(settingsDescribe).toHaveBeenCalledTimes(2) })
  releaseSettle()
  await waitFor(() => { expect(editor.value).toBe(JSON.stringify({ label: 'canonical' }, null, 2)) })
  releaseSlow()
  await new Promise<void>((resolve) => { setTimeout(resolve, 20) })
  expect(editor.value).toBe(JSON.stringify({ label: 'canonical' }, null, 2))
})

it('keeps an unsaved edit when refresh follows a failed post-save describe', async () => {
  let user: Record<string, unknown> = { label: 'canonical' }
  let revision = 1
  const row = (): NativeSettingsDescriptor => ({
    namespace: 'llm-pi-ai', schema: {}, value: {}, base: {}, user, applies: 'live', secrets: [],
    credentialRefs: [], revision,
  })
  const settingsDescribe = vi.fn(async () => {
    if (settingsDescribe.mock.calls.length === 2) throw new Error('describe failed')
    return settingsDescription([row()])
  })
  const settingsMutate = vi.fn(async () => {
    user = { label: 'saved' }
    revision = 2
    return row()
  })
  const actions = {
    settingsDescribe, settingsMutate,
    credentialsDescribe: vi.fn(async () => ({})), authorizationList: vi.fn(async () => []),
  } as unknown as NativeSessionClient
  render(<SettingsPage actions={actions} t={key => en[key]} onBack={() => undefined} />)
  const editor = await screen.findByLabelText(`${en.userOverrides} llm-pi-ai`) as HTMLTextAreaElement
  fireEvent.change(editor, { target: { value: JSON.stringify({ label: 'saved' }) } })
  fireEvent.click(screen.getByRole('button', { name: en.saveSettings }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  const edited = '{ "label": "unsaved" }'
  fireEvent.change(editor, { target: { value: edited } })
  fireEvent.click(screen.getByRole('button', { name: en.refreshSettings }))
  expect(await screen.findByText(`${en.appliesLive} · ${en.revision}: 2`)).toBeTruthy()
  expect(editor.value).toBe(edited)
})

it('refresh settles authorization and drops a stale disconnect warning', async () => {
  const key = credentialKey('llm-pi-ai', 'openai-codex')
  let listed: string | undefined = 'a1'
  const authorizationList = vi.fn(async () => [{
    key, label: 'OpenAI Codex', methods: [{ id: 'oauth', label: 'OAuth' }],
    configured: false, writable: true, ...(listed === undefined ? {} : { attemptId: listed }),
  }])
  const authorizationFrames = vi.fn(async function* () { throw new Error('HTTP 409: unavailable attempt') })
  const actions = {
    settingsDescribe: vi.fn(async () => settingsDescription([])),
    settingsMutate: vi.fn(), credentialsDescribe: vi.fn(async () => ({})),
    credentialsSet: vi.fn(), credentialsUnset: vi.fn(), authorizationList,
    authorizationBegin: vi.fn(), authorizationFrames,
    authorizationAnswer: vi.fn(), authorizationDecline: vi.fn(), authorizationCancel: vi.fn(),
  } as unknown as NativeSettingsActions
  const onAuthorized = vi.fn()
  render(<SettingsPage actions={actions} t={localeKey => en[localeKey]} onBack={() => undefined} onAuthorized={onAuthorized} />)
  expect(await screen.findByText(en.authorizationDisconnected)).toBeTruthy()
  expect(onAuthorized).toHaveBeenCalledOnce()
  listed = undefined
  fireEvent.click(screen.getByRole('button', { name: en.refreshSettings }))
  await waitFor(() => { expect(onAuthorized).toHaveBeenCalledTimes(2) })
  await waitFor(() => { expect(authorizationFrames).toHaveBeenCalledTimes(3) })
  await new Promise<void>((resolve) => { setTimeout(resolve, 20) })
  expect(screen.queryByText(en.authorizationDisconnected)).toBeNull()
})
