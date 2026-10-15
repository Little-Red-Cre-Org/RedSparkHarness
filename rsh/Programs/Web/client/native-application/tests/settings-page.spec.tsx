// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { assertServiceable, Config as PiAiConfig, resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai/src/config.ts'
import { NativeSettings, type NativeSettingsDescriptor as ServiceNativeSettingsDescriptor,
  type NativeSettingsPathOp, type NativeSettingsSection } from '@deepseek-ai/dsh-settings/native'
import { credentialKey, type NativeCredentials } from '@deepseek-ai/dsh-credentials/native'
import { NativeScope, RuntimeEvents } from '@deepseek-ai/dsh-native-runtime'
import { NativeAuthorizationProvider, type AuthorizationPromptId } from '@deepseek-ai/dsh-authorization/native'
import type { NativeAccountBalance, NativeAccountSummary, NativeAccountUsage, NativeAgentPresetList, NativeSettingsEvent, NativeSessionClient, NativeSettingsDescriptor, NativeSettingsDescription } from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeLocaleService, NativeLocaleSnapshot } from '@deepseek-ai/dsh-client-locale/native'
import type { NativeThemeService } from '@deepseek-ai/dsh-client-ui-theme/native'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh } from '../src/locales.ts'
import { SettingsPage, nativeSettingsDiff, type NativeSettingsActions } from '../src/settings-page.tsx'
import { PENDING_DEFAULT_KEY, type BusyEnterBehavior } from '../src/pending-default.ts'

afterEach(() => {
  cleanup()
  localStorage.removeItem(PENDING_DEFAULT_KEY)
})

const locales = [{ language: 'en', strings: en }, { language: 'zh', strings: zh }] as const
const defaultLimits = { maxCredentialRefsPerRead: 64, maxSettingsOperations: 512 }
const localeSnapshot: NativeLocaleSnapshot = { locale: 'en', revision: 0 }
const themeSnapshot: ReturnType<NativeThemeService['getSnapshot']> = {
  preference: 'system', fontSize: 14,
  active: { id: 'light', colorScheme: 'light', tokens: {} },
  themes: [
    { id: 'light', colorScheme: 'light', tokens: {} },
    { id: 'dark', colorScheme: 'dark', tokens: {} },
  ],
  revision: 0,
}
const useLocale: SnapshotSelectorHook<NativeLocaleSnapshot> = selector => selector(localeSnapshot)
const useTheme: SnapshotSelectorHook<ReturnType<NativeThemeService['getSnapshot']>> = selector => selector(themeSnapshot)
const emptyAccountActions = {
  accountsList: async () => [],
  accountsUsage: async () => ({ status: 'unsupported' as const }),
  accountsBalance: async () => ({ status: 'unsupported' as const }),
  accountsSignOut: async () => undefined,
}
const emptyModelActions = {
  modelsListProviders: async () => [],
  modelsListConfigurableProviders: async () => [],
  modelsDiscover: async () => [],
  modelCatalog: async () => null,
  settingsEvents: async function* (signal: AbortSignal) {
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve()
      else signal.addEventListener('abort', () => { resolve() }, { once: true })
    })
  },
}
function renderSettingsPage(props: {
  actions: NativeSettingsActions
  t: (key: keyof typeof en) => string
  section?: string
  onAuthorized?: () => void
  useLocale?: SnapshotSelectorHook<NativeLocaleSnapshot>
  useTheme?: SnapshotSelectorHook<ReturnType<NativeThemeService['getSnapshot']>>
  setLocale?: NativeLocaleService['setLocale']
  setThemePreference?: NativeThemeService['setPreference']
  setFontSize?: NativeThemeService['setFontSize']
  onDocumentAvailabilityChange?: (available: boolean) => void
}) {
  return render(<SettingsPage {...props} actions={{ ...emptyAccountActions, ...emptyModelActions, ...props.actions }}
    section={props.section ?? 'general'} useLocale={props.useLocale ?? useLocale}
    useTheme={props.useTheme ?? useTheme} setLocale={props.setLocale ?? (() => {})}
    setThemePreference={props.setThemePreference ?? (() => {})} setFontSize={props.setFontSize ?? (() => {})} />)
}
const settingsDescription = (
  namespaces: readonly (NativeSettingsDescriptor | ServiceNativeSettingsDescriptor)[], limits = defaultLimits,
): NativeSettingsDescription => ({
  hasDocument: false,
  namespaces: namespaces as readonly NativeSettingsDescriptor[],
  limits,
})
const pluginSettings = (
  namespace: string, revision: number, value: Readonly<Record<string, unknown>>,
  user: Readonly<Record<string, unknown>> = {},
): NativeSettingsDescriptor => ({
  namespace, schema: {}, value, base: value, user, applies: 'live', secrets: [],
  credentialRefs: namespace === 'web-search-deepseek' ? ['DEEPSEEK_API_KEY'] : [], revision,
})

const chatGptAccount: NativeAccountSummary = {
  key: 'llm-pi-ai/openai-codex', provider: 'openai-codex', status: 'ready',
  identity: { email: 'account@example.com', contact: null, name: null, avatarUrl: null }, plan: null,
}
const readyUsage: Extract<NativeAccountUsage, { status: 'ready' }> = {
  status: 'ready', email: null, plan: 'Plus',
  quotas: [{ name: 'codex', primary: { usedPercent: 35, windowSeconds: 3600, resetsAt: null }, secondary: null }],
  credits: null,
}

function accountPageActions(
  accountsUsage: NativeSettingsActions['accountsUsage'],
  accountsList = vi.fn(async () => [chatGptAccount]),
  accountsBalance: NativeSettingsActions['accountsBalance'] = emptyAccountActions.accountsBalance,
) {
  return {
    ...emptyAccountActions,
    settingsDescribe: vi.fn(async () => settingsDescription([])),
    settingsMutate: vi.fn(),
    credentialsDescribe: vi.fn(async () => ({})),
    credentialsSet: vi.fn(), credentialsUnset: vi.fn(),
    authorizationList: vi.fn(async () => []),
    authorizationBegin: vi.fn(), authorizationFrames: vi.fn(async function* () {}),
    authorizationAnswer: vi.fn(), authorizationDecline: vi.fn(), authorizationCancel: vi.fn(),
    accountsList,
    accountsUsage,
    accountsBalance,
  } as unknown as NativeSettingsActions
}

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

it('renders ChatGPT plan and remaining quota', async () => {
  const actions = accountPageActions(vi.fn(async () => readyUsage))
  renderSettingsPage({ actions, t: key => en[key], section: 'models' })

  expect(await screen.findByText('Plan: Plus')).toBeTruthy()
  expect(screen.getByText('Remaining 65%')).toBeTruthy()
  expect(screen.getByRole('progressbar').getAttribute('value')).toBe('65')
})

it('shows the four native Plugins configuration cards', async () => {
  const webSearch = pluginSettings('web-search-deepseek', 1, {
    apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: '', maxUses: 5,
  })
  const actions = accountPageActions(vi.fn(async () => ({ status: 'unsupported' as const })))
  actions.settingsDescribe = vi.fn(async () => settingsDescription([webSearch]))
  renderSettingsPage({ actions, t: key => en[key], section: 'plugins' })

  expect(await screen.findByRole('tab', { name: en.settingsPluginConfigTab })).toBeTruthy()
  expect(screen.getByRole('tab', { name: en.settingsPluginInventoryTab })).toBeTruthy()
  for (const label of ['Shell', 'Agent loop', 'Subagent', 'Web search']) {
    expect(screen.getByRole('button', { name: `Show settings: ${label}` })).toBeTruthy()
  }
})

it('keeps a staged plugin write fenced to the descriptor revision where editing began', async () => {
  const routeA = { provider: 'provider', model: 'model-a' }
  const routeB = { provider: 'provider', model: 'model-b' }
  const initial = pluginSettings('subagent-model-selection', 1, { enabled: true, allowedModels: [routeA] })
  const updatedElsewhere = pluginSettings('subagent-model-selection', 2, { enabled: false, allowedModels: [{ provider: 'provider', model: 'model-c' }] })
  let releaseEvent!: () => void
  const event = new Promise<void>((resolve) => { releaseEvent = resolve })
  const actions = accountPageActions(vi.fn(async () => ({ status: 'unsupported' as const })))
  let describeCount = 0
  actions.settingsDescribe = vi.fn(async () => {
    describeCount += 1
    return settingsDescription(describeCount === 1 ? [initial] : [updatedElsewhere])
  })
  actions.settingsEvents = async function* () {
    await event
    yield { type: 'settings/document-updated', namespace: 'subagent-model-selection', revision: 2 }
  }
  actions.modelCatalog = vi.fn(async () => ({
    default: routeA, routableProviders: ['provider'], failures: [],
    groups: [{ id: 'provider', name: 'Provider', models: [
      { id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }, { id: 'model-c', name: 'Model C' },
    ] }],
  }))
  const conflict = Object.assign(new Error('conflict'), { code: 'native/settings-conflict' })
  actions.settingsMutate = vi.fn(async () => { throw conflict })
  renderSettingsPage({ actions, t: key => en[key], section: 'plugins' })

  fireEvent.click(await screen.findByRole('button', { name: 'Show settings: Subagent' }))
  fireEvent.click(await screen.findByRole('checkbox', { name: /Model B/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: /Model A/ }))
  releaseEvent()
  await waitFor(() => { expect(screen.getByRole('checkbox', { name: en.settingsPluginSubagentToggle })).toHaveProperty('checked', false) })
  fireEvent.click(screen.getByRole('button', { name: en.settingsPluginSave }))

  expect(await screen.findByText(en.settingsPluginConflict)).toBeTruthy()
  expect(actions.settingsMutate).toHaveBeenCalledWith('subagent-model-selection', [
    { op: 'set', path: ['allowedModels'], value: [routeB] },
  ], 1)
})

it('supports arrow, Home, and End keyboard navigation across plugin tabs', async () => {
  const actions = accountPageActions(vi.fn(async () => ({ status: 'unsupported' as const })))
  renderSettingsPage({ actions, t: key => en[key], section: 'plugins' })
  const config = await screen.findByRole('tab', { name: en.settingsPluginConfigTab })
  const inventory = screen.getByRole('tab', { name: en.settingsPluginInventoryTab })

  fireEvent.keyDown(config, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(inventory)
  expect(inventory.getAttribute('aria-selected')).toBe('true')
  fireEvent.keyDown(inventory, { key: 'ArrowLeft' })
  expect(document.activeElement).toBe(config)
  fireEvent.keyDown(config, { key: 'End' })
  expect(document.activeElement).toBe(inventory)
  fireEvent.keyDown(inventory, { key: 'Home' })
  expect(document.activeElement).toBe(config)
})

it('saves web-search settings and its write-only key through Native Host actions', async () => {
  const initial = pluginSettings('web-search-deepseek', 1, {
    apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: '', maxUses: 5,
  })
  let configured = false
  const updated = pluginSettings('web-search-deepseek', 2, {
    apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: '', maxUses: 9,
  }, { maxUses: 9 })
  const settingsMutate = vi.fn(async () => updated)
  const credentialsSet = vi.fn(async () => { configured = true })
  const credentialsDescribe = vi.fn(async () => ({
    DEEPSEEK_API_KEY: { configured, writable: true },
  }))
  const actions = accountPageActions(vi.fn(async () => ({ status: 'unsupported' as const })))
  actions.settingsDescribe = vi.fn(async () => settingsDescription([initial]))
  actions.settingsMutate = settingsMutate
  actions.credentialsDescribe = credentialsDescribe
  actions.credentialsSet = credentialsSet
  renderSettingsPage({ actions, t: key => en[key], section: 'plugins' })

  fireEvent.click(await screen.findByRole('button', { name: 'Show settings: Web search' }))
  fireEvent.change(await screen.findByLabelText(en.settingsPluginWebSearchMaxUses), { target: { value: '9' } })
  fireEvent.change(screen.getByLabelText(en.settingsPluginWebSearchApiKey), { target: { value: 'plugin-secret' } })
  fireEvent.click(screen.getByRole('button', { name: en.settingsPluginSave }))

  await waitFor(() => { expect(credentialsSet).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'plugin-secret') })
  expect(settingsMutate).toHaveBeenCalledWith('web-search-deepseek', [
    { op: 'set', path: ['maxUses'], value: 9 },
  ], 1)
})

it('shows a Host gap for an absent plugin namespace without a save action', async () => {
  const actions = accountPageActions(vi.fn(async () => ({ status: 'unsupported' as const })))
  actions.settingsDescribe = vi.fn(async () => settingsDescription([]))
  renderSettingsPage({ actions, t: key => en[key], section: 'plugins' })

  fireEvent.click(await screen.findByRole('button', { name: 'Show settings: Shell' }))
  expect(await screen.findByText(en.settingsPluginHostGap)).toBeTruthy()
  expect(zh.settingsPluginHostGap).toBe('当前 Host 尚未开放此插件的设置。')
  expect(en.settingsPluginHostGap).toBe('The current Host has not opened settings for this plugin yet.')
  expect(screen.queryByRole('button', { name: en.settingsPluginSave })).toBeNull()
})

it('retains the last plugin settings, revision, and credential info when a refresh omits its namespace', async () => {
  const webSearch = pluginSettings('web-search-deepseek', 1, {
    apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: '', maxUses: 5,
  })
  let releaseRefresh!: () => void
  const refresh = new Promise<void>((resolve) => { releaseRefresh = resolve })
  const actions = accountPageActions(vi.fn(async () => ({ status: 'unsupported' as const })))
  let describeCount = 0
  actions.settingsDescribe = vi.fn(async () => {
    describeCount += 1
    return settingsDescription(describeCount === 1 ? [webSearch] : [])
  })
  actions.settingsMutate = vi.fn(async () => pluginSettings('web-search-deepseek', 2, {
    apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: '', maxUses: 9,
  }, { maxUses: 9 }))
  actions.credentialsDescribe = vi.fn(async () => ({
    DEEPSEEK_API_KEY: { configured: true, writable: true },
  }))
  actions.settingsEvents = async function* () {
    await refresh
    yield { type: 'settings/document-updated', namespace: 'web-search-deepseek', revision: 2 }
  }
  renderSettingsPage({ actions, t: key => en[key], section: 'plugins' })

  fireEvent.click(await screen.findByRole('button', { name: 'Show settings: Web search' }))
  expect(await screen.findByText(en.settingsPluginWebSearchApiKeySet)).toBeTruthy()
  releaseRefresh()
  await waitFor(() => { expect(actions.credentialsDescribe).toHaveBeenCalledTimes(2) })

  expect(screen.getByLabelText(en.settingsPluginWebSearchMaxUses)).toHaveProperty('value', '5')
  expect(screen.getByText(en.settingsPluginWebSearchApiKeySet)).toBeTruthy()
  expect(screen.queryByText(en.settingsPluginHostGap)).toBeNull()

  fireEvent.change(screen.getByLabelText(en.settingsPluginWebSearchMaxUses), { target: { value: '9' } })
  fireEvent.click(screen.getByRole('button', { name: en.settingsPluginSave }))
  await waitFor(() => {
    expect(actions.settingsMutate).toHaveBeenCalledWith('web-search-deepseek', [
      { op: 'set', path: ['maxUses'], value: 9 },
    ], 1)
  })
})

it('renders the ChatGPT identity name before the email', async () => {
  const account = { ...chatGptAccount, identity: { ...chatGptAccount.identity, name: 'Ada Lovelace' } }
  renderSettingsPage({
    actions: accountPageActions(vi.fn(async () => readyUsage), vi.fn(async () => [account])),
    t: key => en[key], section: 'models',
  })

  const name = await screen.findByText('Ada Lovelace')
  const email = screen.getByText('account@example.com')
  expect(name.compareDocumentPosition(email)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
})

it('reads, copies, opens and deletes native Agent presets through Host actions', async () => {
  let roster: NativeAgentPresetList = {
    default: 'standard',
    presets: [
      { id: 'standard', name: 'Standard', description: 'General purpose', source: 'system', status: 'ready' },
      { id: 'legacy', name: 'Legacy', description: 'Older composition', source: 'user', status: 'ready' },
      { id: 'migrating', name: 'Migrating', description: 'Older folder format', source: 'user', status: 'needs-migration' },
      { id: 'damaged', name: 'Damaged', source: 'user', status: 'invalid', problem: 'Composition file is invalid.' },
    ],
  }
  const queued: NativeSettingsEvent[] = []
  let wake: ((event: NativeSettingsEvent | null) => void) | undefined
  const publish = (event: NativeSettingsEvent): void => {
    if (wake === undefined) queued.push(event)
    else {
      const resolve = wake
      wake = undefined
      resolve(event)
    }
  }
  const settingsEvents = async function* (signal: AbortSignal): AsyncIterable<NativeSettingsEvent> {
    while (!signal.aborted) {
      const event = queued.shift() ?? await new Promise<NativeSettingsEvent | null>((resolve) => {
        wake = resolve
        signal.addEventListener('abort', () => { resolve(null) }, { once: true })
      })
      if (event === null) return
      yield event
    }
  }
  const agentPresetsList = vi.fn(async () => roster)
  const agentPresetCopy = vi.fn(async (from: string, id: string, name?: string) => {
    expect(from).toBe('standard')
    roster = { ...roster, presets: [...roster.presets, { id, name: name ?? id, source: 'user', status: 'ready' }] }
    publish({ type: 'agent-presets/updated' })
  })
  const agentPresetDelete = vi.fn(async (id: string) => {
    roster = { ...roster, presets: roster.presets.filter(preset => preset.id !== id) }
    publish({ type: 'agent-presets/updated' })
  })
  const actions = {
    ...accountPageActions(vi.fn(async () => ({ status: 'unsupported' as const })), vi.fn(async () => [])),
    agentPresetsList,
    agentPresetRead: vi.fn(async () => ({ id: 'standard', name: 'Standard', source: 'system', status: 'ready',
      description: 'General purpose', content: '{"formatVersion":1,"installations":[]}' })),
    agentPresetCopy,
    agentPresetDelete,
    agentPresetsCanOpenDirectory: vi.fn(async () => false),
    agentPresetOpenDirectory: vi.fn(async () => ({ opened: false as const, path: '/home/test/.agent-presets/custom-copy' })),
    settingsEvents,
  } as unknown as NativeSettingsActions
  renderSettingsPage({ actions, t: key => en[key], section: 'agent-presets' })

  expect(await screen.findByRole('heading', { name: en.settingsAgentPresets })).toBeTruthy()
  expect(screen.getByText('General purpose')).toBeTruthy()
  expect(screen.getByText(en.agentPresetsDefault)).toBeTruthy()
  expect(screen.getByText(en.agentPresetsNeedsMigration)).toBeTruthy()
  expect(screen.getByText(en.agentPresetsBroken)).toBeTruthy()
  expect(screen.getByText('Composition file is invalid.')).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: en.agentPresetsView })[0]!)
  expect(await screen.findByText('{"formatVersion":1,"installations":[]}')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.close }))

  fireEvent.click(screen.getAllByRole('button', { name: en.agentPresetsDuplicate })[0]!)
  fireEvent.change(screen.getByLabelText(en.agentPresetsIdentifier), { target: { value: 'custom-copy' } })
  fireEvent.change(screen.getByLabelText(en.agentPresetsName), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: en.agentPresetsCreate }))
  expect(agentPresetCopy).toHaveBeenCalledWith('standard', 'custom-copy', undefined)
  expect(await screen.findByRole('heading', { name: 'custom-copy' })).toBeTruthy()
  expect(await screen.findByText('/home/test/.agent-presets/custom-copy')).toBeTruthy()

  const legacyRow = screen.getByRole('heading', { name: 'Legacy' }).closest('li')!
  fireEvent.click(within(legacyRow).getByRole('button', { name: en.agentPresetsDelete }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.agentPresetsDeleteConfirm }))
  await waitFor(() => { expect(screen.queryByText('Legacy')).toBeNull() })
  expect(agentPresetDelete).toHaveBeenCalledWith('legacy')
  expect(agentPresetsList).toHaveBeenCalledTimes(3)
})

it('keeps the later Agent preset detail when an earlier read finishes last', async () => {
  const roster: NativeAgentPresetList = {
    default: 'standard',
    presets: [
      { id: 'standard', name: 'Standard', source: 'system', status: 'ready' },
      { id: 'legacy', name: 'Legacy', source: 'user', status: 'ready' },
    ],
  }
  const settingsEvents = async function* (signal: AbortSignal): AsyncIterable<NativeSettingsEvent> {
    await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
  }
  let finishStandard: ((value: Awaited<ReturnType<NativeSessionClient['agentPresetRead']>>) => void) | undefined
  const agentPresetRead = vi.fn(async (id: string) => {
    if (id === 'standard') {
      return await new Promise<Awaited<ReturnType<NativeSessionClient['agentPresetRead']>>>((resolve) => {
        finishStandard = resolve
      })
    }
    return { id: 'legacy', name: 'Legacy', source: 'user' as const, status: 'ready' as const,
      content: '{"formatVersion":1,"installations":[{"id":"legacy"}]}' }
  })
  const actions = {
    ...accountPageActions(vi.fn(async () => ({ status: 'unsupported' as const })), vi.fn(async () => [])),
    agentPresetsList: vi.fn(async () => roster),
    agentPresetRead,
    agentPresetCopy: vi.fn(async () => {}),
    agentPresetDelete: vi.fn(async () => {}),
    agentPresetsCanOpenDirectory: vi.fn(async () => false),
    agentPresetOpenDirectory: vi.fn(async () => ({ opened: false as const, path: '/tmp' })),
    settingsEvents,
  } as unknown as NativeSettingsActions
  renderSettingsPage({ actions, t: key => en[key], section: 'agent-presets' })
  expect(await screen.findByRole('heading', { name: en.settingsAgentPresets })).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: en.agentPresetsView })[0]!)
  fireEvent.click(screen.getAllByRole('button', { name: en.agentPresetsView })[1]!)
  expect(await screen.findByText('{"formatVersion":1,"installations":[{"id":"legacy"}]}')).toBeTruthy()
  await act(async () => {
    finishStandard?.({ id: 'standard', name: 'Standard', source: 'system', status: 'ready',
      content: '{"formatVersion":1,"installations":[{"id":"stale"}]}' })
  })
  expect(screen.getByText('{"formatVersion":1,"installations":[{"id":"legacy"}]}')).toBeTruthy()
  expect(screen.queryByText('{"formatVersion":1,"installations":[{"id":"stale"}]}')).toBeNull()
})

it('shows that ChatGPT usage appears after the first model call', async () => {
  const accountsUsage = vi.fn(async () => ({ status: 'failed' as const, reason: 'USAGE_PENDING' as const }))
  renderSettingsPage({ actions: accountPageActions(accountsUsage), t: key => en[key], section: 'models' })

  const notice = await screen.findByRole('status')
  expect(notice.textContent).toBe(en.usagePending)
  expect(screen.queryByText(en.accountUnavailable)).toBeNull()
})

it('re-reads pending ChatGPT usage after the Settings page remounts', async () => {
  const accountsUsage = vi.fn()
    .mockResolvedValueOnce({ status: 'failed' as const, reason: 'USAGE_PENDING' as const })
    .mockResolvedValueOnce(readyUsage)
  const actions = accountPageActions(accountsUsage)
  const firstPage = renderSettingsPage({ actions, t: key => en[key], section: 'models' })

  expect(await screen.findByText(en.usagePending)).toBeTruthy()
  firstPage.unmount()
  renderSettingsPage({ actions, t: key => en[key], section: 'models' })

  expect(await screen.findByRole('progressbar')).toBeTruthy()
  expect(accountsUsage).toHaveBeenCalledTimes(2)
})

it('renders a subscription account inside its authorization row', async () => {
  const entry = {
    key: chatGptAccount.key, label: 'ChatGPT subscription (Sign in with ChatGPT)',
    methods: [{ id: 'oauth', label: 'OAuth' }], configured: true, writable: true,
  }
  const actions = {
    ...accountPageActions(vi.fn(async () => readyUsage)),
    authorizationList: vi.fn(async () => [entry]),
  } as unknown as NativeSettingsActions
  renderSettingsPage({ actions, t: key => en[key], section: 'models' })

  const subscription = screen.getByRole('region', { name: en.subscriptionModels })
  const row = await within(subscription).findByRole('group', { name: entry.label })
  expect(within(row).getByText(en.authorizationConnected)).toBeTruthy()
  expect(within(row).getByRole('button', { name: en.authorizationReconnect })).toBeTruthy()
  expect(within(row).getByRole('heading', { name: en.chatGptAccount })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Accounts' })).toBeNull()
})

it('keeps ready usage and shows a stale hint after refresh failure', async () => {
  const accountsUsage = vi.fn()
    .mockResolvedValueOnce(readyUsage)
    .mockResolvedValueOnce({ status: 'failed', reason: 'offline' })
  const accountsList = vi.fn(async () => [chatGptAccount])
  const actions = accountPageActions(accountsUsage, accountsList)
  renderSettingsPage({ actions, t: key => en[key], section: 'models' })

  expect(await screen.findByText('Remaining 65%')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.refreshAccount }))

  expect(await screen.findByText(en.usageStale)).toBeTruthy()
  expect(screen.getByText('Plan: Plus')).toBeTruthy()
  expect(screen.getByText('Remaining 65%')).toBeTruthy()
  expect(accountsUsage).toHaveBeenCalledTimes(2)
  expect(accountsList).toHaveBeenCalledTimes(2)
})

it('clears ready usage when the signed-in account changes', async () => {
  const accountA = { ...chatGptAccount, identity: { ...chatGptAccount.identity, email: 'a@example.com' } }
  const accountB = { ...chatGptAccount, identity: { ...chatGptAccount.identity, email: 'b@example.com' } }
  const accountsUsage = vi.fn()
    .mockResolvedValueOnce({ ...readyUsage, email: 'a@example.com', plan: 'Account A plan' })
    .mockResolvedValueOnce({ status: 'failed', reason: 'offline' })
  const accountsList = vi.fn()
    .mockResolvedValueOnce([accountA])
    .mockResolvedValueOnce([accountB])
  renderSettingsPage({ actions: accountPageActions(accountsUsage, accountsList), t: key => en[key], section: 'models' })

  expect(await screen.findByText('a@example.com')).toBeTruthy()
  expect(screen.getByText('Plan: Account A plan')).toBeTruthy()
  expect(screen.getByText('Remaining 65%')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.refreshAccount }))

  expect(await screen.findByText(en.accountUnavailable)).toBeTruthy()
  expect(screen.getByText('b@example.com')).toBeTruthy()
  expect(screen.queryByText('a@example.com')).toBeNull()
  expect(screen.queryByText('Plan: Account A plan')).toBeNull()
  expect(screen.queryByText('Remaining 65%')).toBeNull()
})

it('does not reuse ready usage when account identity emails are null', async () => {
  const account = { ...chatGptAccount, identity: { ...chatGptAccount.identity, email: null } }
  const accountsUsage = vi.fn()
    .mockResolvedValueOnce({ ...readyUsage, plan: 'Account A plan' })
    .mockResolvedValueOnce({ status: 'failed', reason: 'offline' })
  const accountsList = vi.fn(async () => [account])
  renderSettingsPage({ actions: accountPageActions(accountsUsage, accountsList), t: key => en[key], section: 'models' })

  expect(await screen.findByText('Plan: Account A plan')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.refreshAccount }))

  expect(await screen.findByText(en.accountUnavailable)).toBeTruthy()
  expect(screen.queryByText('Plan: Account A plan')).toBeNull()
})

it('renders DeepSeek identity, wallet balance and bonus balance', async () => {
  const deepSeek: NativeAccountSummary = {
    key: 'deepseek-account/default', provider: 'deepseek-account', status: 'ready', plan: null,
    identity: { email: null, contact: 'user@example.com', name: 'DeepSeek User', avatarUrl: null },
  }
  const readyBalance: Extract<NativeAccountBalance, { status: 'ready' }> = {
    status: 'ready', wallets: [{ currency: 'CNY', balance: '12.30' }, { currency: 'USD', balance: '0.40' }],
    bonusWallets: [{ currency: 'CNY', balance: '3.00' }],
  }
  const accountsUsage = vi.fn(async () => readyUsage)
  const accountsBalance = vi.fn(async () => readyBalance)
  renderSettingsPage({
    actions: accountPageActions(accountsUsage, vi.fn(async () => [deepSeek, chatGptAccount]), accountsBalance),
    t: key => en[key], section: 'models' })

  expect(await screen.findByRole('heading', { name: en.deepSeekAccount })).toBeTruthy()
  expect(screen.getByRole('heading', { name: en.chatGptAccount })).toBeTruthy()
  expect(await screen.findByText('Plan: Plus')).toBeTruthy()
  expect(screen.getByText('DeepSeek User')).toBeTruthy()
  expect(screen.getByText('user@example.com')).toBeTruthy()
  expect(screen.getByText('¥12.30')).toBeTruthy()
  expect(screen.getByText('$0.40')).toBeTruthy()
  expect(screen.getByText('¥3.00')).toBeTruthy()
  expect(accountsBalance).toHaveBeenCalledWith(deepSeek.key, expect.anything())
  expect(accountsUsage).toHaveBeenCalledWith(chatGptAccount.key, expect.anything())
})

it.each([
  { contact: 'user@example.com', notice: en.balanceStale, keepsBalance: true },
  { contact: null, notice: en.balanceUnavailable, keepsBalance: false },
])('DeepSeek refresh failure with contact $contact keeps balance: $keepsBalance', async ({ contact, notice, keepsBalance }) => {
  const deepSeek: NativeAccountSummary = {
    key: 'deepseek-account/default', provider: 'deepseek-account', status: 'ready', plan: null,
    identity: { email: null, contact, name: 'DeepSeek User', avatarUrl: null },
  }
  const accountsBalance = vi.fn()
    .mockResolvedValueOnce({ status: 'ready', wallets: [{ currency: 'CNY', balance: '12.30' }], bonusWallets: [] })
    .mockResolvedValueOnce({ status: 'failed' })
  renderSettingsPage({
    actions: accountPageActions(vi.fn(async () => readyUsage), vi.fn(async () => [deepSeek]), accountsBalance),
    t: key => en[key], section: 'models' })

  expect(await screen.findByText('¥12.30')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.refreshAccount }))

  expect(await screen.findByText(notice)).toBeTruthy()
  expect(screen.queryByText('¥12.30') !== null).toBe(keepsBalance)
  expect(accountsBalance).toHaveBeenCalledTimes(2)
})

it('refreshes model controls after signing out', async () => {
  const onAuthorized = vi.fn()
  renderSettingsPage({
    actions: accountPageActions(vi.fn(async () => readyUsage)), t: key => en[key], section: 'models', onAuthorized })

  fireEvent.click(await screen.findByRole('button', { name: en.signOut }))

  await waitFor(() => { expect(onAuthorized).toHaveBeenCalledOnce() })
})

it('keeps the newest account list when older refreshes finish last', async () => {
  const accountA = { ...chatGptAccount, identity: { ...chatGptAccount.identity, email: 'a@example.com' } }
  const accountB = { ...chatGptAccount, identity: { ...chatGptAccount.identity, email: 'b@example.com' } }
  let resolveOlder!: (accounts: readonly NativeAccountSummary[]) => void
  let resolveNewer!: (accounts: readonly NativeAccountSummary[]) => void
  const older = new Promise<readonly NativeAccountSummary[]>((resolve) => { resolveOlder = resolve })
  const newer = new Promise<readonly NativeAccountSummary[]>((resolve) => { resolveNewer = resolve })
  const accountsList = vi.fn()
    .mockResolvedValueOnce([chatGptAccount])
    .mockReturnValueOnce(older)
    .mockReturnValueOnce(newer)
  const actions = accountPageActions(vi.fn(async () => readyUsage), accountsList)
  renderSettingsPage({ actions, t: key => en[key], section: 'models' })

  const refreshButton = await screen.findByRole('button', { name: en.refreshAccount }) as HTMLButtonElement
  await waitFor(() => { expect(refreshButton.disabled).toBe(false) })
  fireEvent.click(refreshButton)
  fireEvent.click(refreshButton)
  resolveNewer([accountB])
  expect(await screen.findByText('b@example.com')).toBeTruthy()

  await act(async () => {
    resolveOlder([accountA])
    await older
  })

  expect(screen.getByText('b@example.com')).toBeTruthy()
  expect(screen.queryByText('a@example.com')).toBeNull()
})

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
    renderSettingsPage({ actions: client, t: key => strings[key] })
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
  renderSettingsPage({ actions: client, t: key => strings[key] })

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
  renderSettingsPage({ actions: client, t: key => strings[key] })
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
  renderSettingsPage({ actions: client, t: key => strings[key] })
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
  renderSettingsPage({ actions: client, t: key => strings[key] })
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
  renderSettingsPage({ actions: client, t: key => strings[key] })
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
  const props = { actions, t: (localeKey: keyof typeof en) => en[localeKey], section: 'models', onAuthorized }

  try {
    const firstPage = renderSettingsPage(props)
    fireEvent.click(await screen.findByRole('button', { name: en.authorizationLoginAdd }))
    expect(await screen.findByRole('link', { name: 'https://auth.example/device' })).toBeTruthy()
    expect(await screen.findByText('ABCD-1234')).toBeTruthy()
    await screen.findByLabelText('Authorization code')

    firstPage.unmount()
    expect(authorization.current(key)).toBeDefined()
    expect(cancel).not.toHaveBeenCalled()

    renderSettingsPage(props)
    expect(await screen.findByRole('link', { name: 'https://auth.example/device' })).toBeTruthy()
    const input = await screen.findByLabelText('Authorization code')
    fireEvent.change(input, { target: { value: 'secret-answer' } })
    fireEvent.click(screen.getByRole('button', { name: en.authorizationAnswer }))
    await waitFor(() => { expect(onAuthorized).toHaveBeenCalledOnce() })
    expect(screen.queryByText(en.authorizationAuthorized)).toBeNull()
    await waitFor(() => { expect(authorization.current(key)).toBeUndefined() })
    expect(screen.queryByRole('link', { name: 'https://auth.example/device' })).toBeNull()
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
  const page = renderSettingsPage({ actions, t: localeKey => en[localeKey], section: 'models', onAuthorized })

  if (attemptId === undefined) {
    fireEvent.click(await screen.findByRole('button', { name: en.authorizationLoginAdd }))
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

it('keeps settings drafts consistent across saves and refreshes', async () => {
  let user: Record<string, unknown> = { label: 'old' }
  let revision = 1
  let conversationRevision = 1
  let busyEnter: BusyEnterBehavior = 'queue'
  let failDescribe = false
  let releaseSave!: () => void
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve })
  const row = (): NativeSettingsDescriptor => ({
    namespace: 'llm-pi-ai', schema: {}, value: {}, base: {}, user, applies: 'live', secrets: [],
    credentialRefs: [], revision,
  })
  const preferenceRows: NativeSettingsDescriptor[] = [
    { namespace: 'permission', schema: { uid: 5, refs: {
      1: { type: 'const', value: 'read-only' }, 2: { type: 'const', value: 'workspace-write' },
      3: { type: 'const', value: 'danger-full-access' }, 4: { type: 'union', list: [1, 2, 3] },
      5: { type: 'object', dict: { defaultPreset: 4 } },
    } }, value: { defaultPreset: 'workspace-write' }, base: {}, user: {}, applies: 'live', secrets: [], credentialRefs: [], revision: 1 },
    { namespace: 'locale', schema: {}, value: { preference: 'zh' }, base: {}, user: {}, applies: 'live', secrets: [], credentialRefs: [], revision: 1 },
    { namespace: 'ui-theme', schema: {}, value: { preference: 'system', fontSize: 14 }, base: {}, user: {}, applies: 'live', secrets: [], credentialRefs: [], revision: 1 },
    { namespace: 'ui-chat', schema: {}, value: { transcriptView: 'compact' }, base: {}, user: {}, applies: 'live', secrets: [], credentialRefs: [], revision: 1 },
    { namespace: 'ui-conversation', schema: {}, value: { busyEnter }, base: {}, user: {}, applies: 'live', secrets: [], credentialRefs: [], revision: conversationRevision },
    { namespace: 'ui-pet', schema: {}, value: { enabled: true }, base: {}, user: {}, applies: 'live', secrets: [], credentialRefs: [], revision: 1 },
  ]
  const updatedRow = (namespace: string, field: string, value: unknown): NativeSettingsDescriptor => {
    const current = preferenceRows.find(candidate => candidate.namespace === namespace)
    if (current === undefined) throw new Error(`missing test settings row: ${namespace}`)
    const updated = {
      ...current, value: { ...current.value, [field]: value }, user: { ...current.user, [field]: value },
      revision: current.revision + 1,
    }
    preferenceRows.splice(preferenceRows.indexOf(current), 1, updated)
    return updated
  }
  const settingsDescribe = vi.fn(async () => {
    const call = settingsDescribe.mock.calls.length
    if (call === 2) await saveGate
    if (failDescribe) {
      failDescribe = false
      throw new Error('describe failed')
    }
    return settingsDescription([row(), ...preferenceRows], undefined)
  })
  const settingsMutate = vi.fn(async (namespace: string, ops: readonly { path: string[]; value?: unknown }[]) => {
    const operation = ops[0]
    if (namespace === 'llm-pi-ai') {
      user = { label: operation?.value }
      revision += 1
      return row()
    }
    const field = operation?.path[0] ?? ''
    if (namespace === 'ui-conversation') {
      busyEnter = operation?.value as BusyEnterBehavior
      conversationRevision += 1
    }
    return updatedRow(namespace, field, operation?.value)
  })
  const actions = {
    settingsDescribe, settingsMutate,
    credentialsDescribe: vi.fn(async () => ({})), credentialsSet: vi.fn(), credentialsUnset: vi.fn(),
    authorizationList: vi.fn(async () => []),
  } as unknown as NativeSettingsActions
  const setLocale = vi.fn()
  const setThemePreference = vi.fn()
  const setFontSize = vi.fn()
  const page = renderSettingsPage({ actions, t: localeKey => en[localeKey], setLocale, setThemePreference, setFontSize })
  const permission = await screen.findByRole('combobox', { name: en.settingsPermission })
  expect((permission as HTMLSelectElement).value).toBe('workspace-write')
  fireEvent.change(permission, { target: { value: 'danger-full-access' } })
  expect(settingsMutate).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox', { name: en.settingsPermissionAcknowledge }))
  fireEvent.click(screen.getByRole('button', { name: en.settingsPermissionConfirm }))
  await waitFor(() => { expect(settingsMutate).toHaveBeenCalledWith('permission', [{ op: 'set', path: ['defaultPreset'], value: 'danger-full-access' }], 1) })
  fireEvent.change(screen.getByRole('combobox', { name: en.settingsLanguage }), { target: { value: 'en' } })
  expect(setLocale).toHaveBeenCalledWith('en')
  await waitFor(() => { expect(settingsMutate).toHaveBeenCalledWith('locale', [{ op: 'set', path: ['preference'], value: 'en' }], 1) })
  fireEvent.click(screen.getByRole('button', { name: en.settingsDark }))
  expect(setThemePreference).toHaveBeenCalledWith('dark')
  await waitFor(() => { expect(settingsMutate).toHaveBeenCalledWith('ui-theme', [{ op: 'set', path: ['preference'], value: 'dark' }], 1) })
  fireEvent.click(screen.getByRole('button', { name: en.settingsFontSizeIncrease }))
  expect(setFontSize).toHaveBeenCalledWith(15)
  await waitFor(() => { expect(settingsMutate).toHaveBeenCalledWith('ui-theme', [{ op: 'set', path: ['fontSize'], value: 15 }], 2) })
  fireEvent.change(screen.getByRole('combobox', { name: en.settingsTranscript }), { target: { value: 'normal' } })
  await waitFor(() => { expect(settingsMutate).toHaveBeenCalledWith('ui-chat', [{ op: 'set', path: ['transcriptView'], value: 'normal' }], 1) })
  fireEvent.change(screen.getByRole('combobox', { name: en.settingsBusyEnter }), { target: { value: 'steer' } })
  await waitFor(() => { expect(settingsMutate).toHaveBeenCalledWith('ui-conversation', [{ op: 'set', path: ['busyEnter'], value: 'steer' }], 1) })
  expect(localStorage.getItem(PENDING_DEFAULT_KEY)).toBeNull()
  fireEvent.click(screen.getByRole('switch', { name: en.settingsPetToggle }))
  await waitFor(() => { expect(settingsMutate).toHaveBeenCalledWith('ui-pet', [{ op: 'set', path: ['enabled'], value: false }], 1) })
  const advanced = screen.getByText(en.settingsAdvanced).closest('details') as HTMLDetailsElement
  expect(advanced.open).toBe(false)
  expect(advanced.contains(screen.getByLabelText(`${en.userOverrides} llm-pi-ai`))).toBe(true)
  fireEvent.click(screen.getByText(en.settingsAdvanced))
  const editor = await screen.findByLabelText(`${en.userOverrides} llm-pi-ai`) as HTMLTextAreaElement
  const pretty = (value: unknown) => JSON.stringify(value, null, 2)

  // The post-save refresh reads back the value committed by the Host.
  fireEvent.change(editor, { target: { value: '{ "label": "canonical" }' } })
  fireEvent.click(within(editor.closest('section') as HTMLElement).getByRole('button', { name: en.saveSettings }))
  await waitFor(() => { expect(settingsDescribe).toHaveBeenCalledTimes(2) })
  releaseSave()
  await waitFor(() => { expect(editor.disabled).toBe(false) })
  expect(editor.value).toBe(pretty({ label: 'canonical' }))

  // A failed post-save describe keeps a later unsaved edit through the next refresh.
  fireEvent.change(editor, { target: { value: '{ "label": "saved" }' } })
  failDescribe = true
  fireEvent.click(within(editor.closest('section') as HTMLElement).getByRole('button', { name: en.saveSettings }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  const edited = '{ "label": "unsaved" }'
  fireEvent.change(editor, { target: { value: edited } })
  fireEvent.click(screen.getByRole('button', { name: en.refreshSettings }))
  expect(await screen.findByText(`${en.appliesLive} · ${en.revision}: 3`)).toBeTruthy()
  expect(editor.value).toBe(edited)
  page.unmount()

  const fallbackMutate = vi.fn()
  localStorage.setItem(PENDING_DEFAULT_KEY, 'steering')
  renderSettingsPage({
    actions: { ...actions, settingsDescribe: vi.fn(async () => settingsDescription([row()])), settingsMutate: fallbackMutate },
    t: localeKey => en[localeKey],
  })
  const fallbackBusyEnter = await screen.findByRole('combobox', { name: en.settingsBusyEnter })
  expect((fallbackBusyEnter as HTMLSelectElement).value).toBe('steer')
  expect((fallbackBusyEnter as HTMLSelectElement).disabled).toBe(true)
  expect(screen.getByText(en.busySendPreferenceUnavailable)).toBeTruthy()
  fireEvent.change(fallbackBusyEnter, { target: { value: 'queue' } })
  expect(localStorage.getItem(PENDING_DEFAULT_KEY)).toBe('steering')
  expect(fallbackMutate).not.toHaveBeenCalled()
})
it('resumes an in-flight login after leaving and returning to Models', async () => {
  const key = credentialKey('llm-pi-ai', 'openai-codex')
  let attemptId: string | undefined
  const authorizationList = vi.fn(async () => [{ key, label: 'OpenAI Codex', methods: [{ id: 'oauth', label: 'OAuth' }],
    configured: false, writable: true, ...(attemptId === undefined ? {} : { attemptId }) }])
  const actions = {
    settingsDescribe: vi.fn(async () => settingsDescription([])),
    settingsMutate: vi.fn(), credentialsDescribe: vi.fn(async () => ({})),
    credentialsSet: vi.fn(), credentialsUnset: vi.fn(), authorizationList,
    authorizationBegin: vi.fn(async () => { attemptId = 'a1'; return { attemptId } }),
    authorizationFrames: vi.fn(async function* (_key: string, _attemptId: string, signal: AbortSignal) {
      yield { type: 'prompt', promptId: 'p1', prompt: { kind: 'text', message: 'Code' } } as const
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }) })
    }),
    authorizationAnswer: vi.fn(), authorizationDecline: vi.fn(), authorizationCancel: vi.fn(),
  } as unknown as NativeSettingsActions
  const stable = { ...emptyAccountActions, ...emptyModelActions, ...actions }
  const t = (localeKey: keyof typeof en) => en[localeKey]
  const pageProps = { actions: stable, t, useLocale, useTheme, setLocale: () => {}, setThemePreference: () => {}, setFontSize: () => {} }
  const page = render(<SettingsPage {...pageProps} section="models" />)
  fireEvent.click(await screen.findByRole('button', { name: en.authorizationLoginAdd }))
  expect(await screen.findByRole('textbox', { name: 'Code' })).toBeTruthy()
  page.rerender(<SettingsPage {...pageProps} section="general" />)
  page.rerender(<SettingsPage {...pageProps} section="models" />)
  expect(await screen.findByRole('textbox', { name: 'Code' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: en.authorizationLoginAdd })).toBeNull()
  page.unmount()
})
