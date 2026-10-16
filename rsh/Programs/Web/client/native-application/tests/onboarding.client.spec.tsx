// @vitest-environment jsdom
/** Native model onboarding: default route first, required-key copy, and a persisted skip. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import type { NativeSessionClient } from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeLocaleService } from '@deepseek-ai/dsh-client-locale/native'
import type { NativeThemeService } from '@deepseek-ai/dsh-client-ui-theme/native'
import { NativeOnboarding } from '../src/onboarding.tsx'
import { en } from '../src/locales.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const schema = JSON.parse(JSON.stringify(Schema.object({
  providers: Schema.dict(Schema.object({ apiKeyEnv: Schema.string().role('credential-ref'), baseURL: Schema.string() })),
}).toJSON())) as unknown

const route = (provider: string) => ({ provider, displayName: provider, settingsNs: 'llm-pi-ai', settingsPath: ['providers', provider] })

const client = {
  modelsListProviders: vi.fn(async () => [{ id: 'amazon-bedrock' }, { id: 'deepseek' }]),
  modelsListConfigurableProviders: vi.fn(async () => [route('amazon-bedrock'), route('deepseek')]),
  settingsDescribe: vi.fn(async () => ({
    namespaces: [{ namespace: 'llm-pi-ai', schema, value: {
      providers: { 'amazon-bedrock': { apiKeyEnv: 'AWS_KEY' }, deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
    }, base: {}, user: {}, applies: 'live', secrets: [], revision: 0 }],
    limits: { maxCredentialRefsPerRead: 8 },
  })),
  credentialsDescribe: vi.fn(async (refs: string[]) => Object.fromEntries(refs.map(ref => [ref, { configured: false, writable: true }]))),
  modelCatalog: vi.fn(async () => ({ default: { provider: 'deepseek', model: 'deepseek-flash' }, routableProviders: [], groups: [], failures: [] })),
} as unknown as NativeSessionClient
const localeService = { getSnapshot: () => ({ locale: 'en' }), setLocale: () => {} } as unknown as NativeLocaleService
const themeService = { getSnapshot: () => ({ active: { colorScheme: 'light' } }), toggle: () => {} } as unknown as NativeThemeService

const mount = () => render(<NativeOnboarding client={client} localeService={localeService} themeService={themeService}>
  <p>app</p>
</NativeOnboarding>)

it('opens on the default route with a required-key placeholder and remembers Configure later', async () => {
  localStorage.setItem('dsh.native.onboarding.welcome', '2026-08-13.1')
  mount()

  const provider = await screen.findByLabelText<HTMLSelectElement>(en.onboardingProvider)
  expect(provider.value).toBe('deepseek')
  expect(screen.getByLabelText<HTMLInputElement>(en.keyInput).placeholder).toBe(en.keyPlaceholder)

  fireEvent.click(screen.getByText(en.onboardingLater))
  expect(screen.getByText('app')).toBeTruthy()

  cleanup()
  mount()
  expect(screen.getByText('app')).toBeTruthy()
  expect(screen.queryByLabelText(en.onboardingProvider)).toBeNull()
})
