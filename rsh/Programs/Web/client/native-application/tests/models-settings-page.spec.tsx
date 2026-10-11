// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import type { NativeSessionClient, NativeSettingsDescriptor } from '@deepseek-ai/dsh-client-native-session/native'
import { en } from '../src/locales.ts'
import { ModelsSettingsPage } from '../src/models-settings-page.tsx'

afterEach(cleanup)

const deepSeekSchema = Schema.object({
  apiKeyEnv: Schema.string().role('credential-ref'),
  baseURL: Schema.string(),
  defaultContextWindow: Schema.number().default(128_000),
  maxTokens: Schema.number().default(8_192),
  models: Schema.array(Schema.object({
    id: Schema.string().required(), name: Schema.string(), contextWindow: Schema.number(), maxTokens: Schema.number(),
  })).default([]),
})
const piAiSchema = Schema.object({
  providers: Schema.dict(Schema.object({
    apiKeyEnv: Schema.string().role('credential-ref'),
    baseURL: Schema.string(),
    api: Schema.string(),
    models: Schema.array(Schema.object({
      id: Schema.string().required(), name: Schema.string(), contextWindow: Schema.number(), maxTokens: Schema.number(),
    })).default([]),
  })),
})

const deepSeekSettings = (revision = 1, user: Readonly<Record<string, unknown>> = {}): NativeSettingsDescriptor => ({
  namespace: 'llm-deepseek', schema: deepSeekSchema.toJSON(),
  value: { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://api.deepseek.com', defaultContextWindow: 128_000, maxTokens: 8_192, models: [] },
  base: { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://api.deepseek.com', defaultContextWindow: 128_000, maxTokens: 8_192, models: [] },
  user, applies: 'live', secrets: [], credentialRefs: ['DEEPSEEK_API_KEY'], revision,
})
const openAiSettings: NativeSettingsDescriptor = {
  namespace: 'llm-pi-ai', schema: piAiSchema.toJSON(),
  value: { providers: { openai: {
    apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://proxy.example/v1', api: 'openai-completions', models: [],
  } } },
  base: { providers: {} }, user: {}, applies: 'live', secrets: [], credentialRefs: ['OPENAI_API_KEY'], revision: 1,
}

const events = async function* (signal: AbortSignal) {
  await new Promise<void>((resolve) => {
    if (signal.aborted) resolve()
    else signal.addEventListener('abort', () => { resolve() }, { once: true })
  })
}

function harness(overrides: Partial<NativeSessionClient> = {}) {
  const actions = {
    modelsListProviders: vi.fn(async () => [{ id: 'deepseek-official', name: 'DeepSeek' }]),
    modelsListConfigurableProviders: vi.fn(async () => [{
      provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [],
    }]),
    modelsDiscover: vi.fn(async () => []),
    settingsDescribe: vi.fn(async () => ({
      namespaces: [deepSeekSettings()], limits: { maxCredentialRefsPerRead: 64, maxSettingsOperations: 512 },
    })),
    settingsMutate: vi.fn(async () => deepSeekSettings(2)),
    credentialsDescribe: vi.fn(async () => ({ DEEPSEEK_API_KEY: { configured: true, writable: true } })),
    credentialsSet: vi.fn(async () => undefined),
    credentialsUnset: vi.fn(async () => undefined),
    settingsEvents: events,
    ...overrides,
  } as unknown as ComponentProps<typeof ModelsSettingsPage>['actions']
  render(<ModelsSettingsPage actions={actions} t={key => en[key]} />)
  return actions
}

it('renders providers advertised by the configurable provider directory', async () => {
  harness()

  expect(await screen.findByText('DeepSeek')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Edit DeepSeek (deepseek-official)' })).toBeTruthy()
})

it('writes a newly added model through native settingsMutate', async () => {
  const actions = harness({
    settingsMutate: vi.fn(async (_namespace, operations, revision) => {
      expect(revision).toBe(1)
      expect(operations).toEqual([{ op: 'set', path: ['models'], value: [expect.objectContaining({ id: 'new-model' })] }])
      return deepSeekSettings(2, { models: [{ id: 'new-model' }] })
    }),
  })

  fireEvent.click(await screen.findByRole('button', { name: 'Edit DeepSeek (deepseek-official)' }))
  fireEvent.click(screen.getByText(en.customized))
  fireEvent.click(screen.getByRole('button', { name: en.addModel }))
  fireEvent.change(screen.getByLabelText(`${en.modelId} 1`), { target: { value: 'new-model' } })
  fireEvent.click(screen.getByRole('button', { name: en.apply }))

  await waitFor(() => { expect(actions.settingsMutate).toHaveBeenCalledOnce() })
})

it('sends endpoint discovery through modelsDiscover without storing the entered key', async () => {
  const actions = harness({
    modelsListProviders: vi.fn(async () => [{ id: 'openai', name: 'OpenAI' }]),
    modelsListConfigurableProviders: vi.fn(async () => [{
      provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'],
    }]),
    settingsDescribe: vi.fn(async () => ({
      namespaces: [openAiSettings], limits: { maxCredentialRefsPerRead: 64, maxSettingsOperations: 512 },
    })),
    credentialsDescribe: vi.fn(async () => ({ OPENAI_API_KEY: { configured: true, writable: true } })),
  })

  fireEvent.click(await screen.findByRole('button', { name: 'Edit OpenAI (openai)' }))
  fireEvent.click(screen.getByText(en.customized))
  fireEvent.change(screen.getByLabelText(en.keyInput), { target: { value: 'probe-only-key' } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: en.fetchModels }))
  })

  await waitFor(() => {
    expect(actions.modelsDiscover).toHaveBeenCalledWith('llm-pi-ai', {
      provider: 'openai', baseURL: 'https://proxy.example/v1', api: 'openai-completions', apiKey: 'probe-only-key',
    }, expect.any(AbortSignal))
  })
  const signal = vi.mocked(actions.modelsDiscover).mock.calls[0]?.[2] as AbortSignal
  expect(signal.aborted).toBe(false)
  cleanup()
  expect(signal.aborted).toBe(true)
  expect(actions.credentialsSet).not.toHaveBeenCalled()
  expect(actions.settingsMutate).not.toHaveBeenCalled()
})
