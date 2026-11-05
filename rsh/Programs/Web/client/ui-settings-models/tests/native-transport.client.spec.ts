/**
 * Native Models transport: the browser page's ports answered over
 * `clientNativeSession`, plus the schema port a Native composition supplies.
 */
import { describe, expect, it, vi } from 'vitest'
import type {
  NativeConfigurableModelProvider, NativeCredentialInfo, NativeLlmProviderInfo,
  NativeSessionClient, NativeSettingsDescription, NativeSettingsDescriptor,
} from '@redspark/rsh-client-native-session/native'
import { createNativeDescribeFace, toDescribeView } from '../src/native-describe.ts'
import {
  createNativeModelsFace, followInvalidations, toCredentialFacts, toNamespaceView,
} from '../src/native.ts'
import { resolveNativeSchema } from '../src/native-schema.ts'
import { createSettingsSchemaOperations } from '../src/client/schema-operations.ts'

/** The lifetime every port call here is bound to. */
const signal = new AbortController().signal

/** Build one redacted descriptor with only the fields the projection reads. */
function descriptor(over: Partial<NativeSettingsDescriptor> = {}): NativeSettingsDescriptor {
  return {
    namespace: 'llm-deepseek', schema: { type: 'object' }, value: { apiKeyEnv: 'DEEPSEEK_API_KEY' },
    base: {}, user: {}, applies: 'live', secrets: [{ path: ['apiKey'], set: true }],
    credentialRefs: [], revision: 3, ...over,
  }
}

/** Build a client stub over the methods these ports drive. */
function client(over: Partial<Record<string, unknown>> = {}): NativeSessionClient {
  return {
    modelsListProviders: async (): Promise<readonly NativeLlmProviderInfo[]> => [{ id: 'deepseek', name: 'DeepSeek' }],
    modelsListConfigurableProviders: async (): Promise<readonly NativeConfigurableModelProvider[]> => [],
    modelsDiscover: async (): Promise<readonly { id: string }[]> => [{ id: 'm-1' }],
    credentialsDescribe: async (refs: readonly string[]): Promise<Readonly<Record<string, NativeCredentialInfo>>> =>
      Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true }])),
    credentialsSet: async (): Promise<void> => {},
    credentialsUnset: async (): Promise<void> => {},
    settingsMutate: async (): Promise<NativeSettingsDescriptor> => descriptor({ revision: 4 }),
    settingsDescribe: async (): Promise<NativeSettingsDescription> => ({
      hasDocument: true,
      namespaces: [descriptor()],
      limits: { maxCredentialRefsPerRead: 64, maxSettingsOperations: 32 },
    }),
    settingsEvents: async function* (): AsyncIterable<{ type: 'llm/adapters-updated' }> { yield { type: 'llm/adapters-updated' } },
    ...over,
  } as unknown as NativeSessionClient
}

describe('toNamespaceView', () => {
  it('renames the Host spelling to the wire spelling and keeps secret slots', () => {
    const view = toNamespaceView(descriptor({ namespace: 'llm-pi-ai' }))
    expect(view.ns).toBe('llm-pi-ai')
    expect(view.revision).toBe(3)
    expect(view.secrets).toEqual([{ path: ['apiKey'], set: true }])
  })

  it('carries both layers the Host reported, including empty ones', () => {
    const view = toNamespaceView(descriptor({ base: {}, user: { enabled: true } }))
    expect(view.base).toEqual({})
    expect(view.user).toEqual({ enabled: true })
  })
})

describe('toCredentialFacts', () => {
  it('keys presence facts by the refs that were asked for', () => {
    expect(toCredentialFacts(['A_KEY'], { A_KEY: { configured: true, writable: false, source: 'file' } }))
      .toEqual({ A_KEY: { configured: true, writable: false, source: 'file' } })
  })

  it('drops a requested ref the Host did not describe', () => {
    expect(toCredentialFacts(['A_KEY'], {})).toEqual({})
  })
})

describe('createNativeModelsFace', () => {
  it('answers the directory reads in the carrier envelope', async () => {
    const face = createNativeModelsFace({ ...client() }, signal)
    await expect(face.llm.listProviders()).resolves.toEqual({
      ok: true, value: [{ id: 'deepseek', name: 'DeepSeek' }],
    })
    await expect(face.llm.listConfigurableProviders()).resolves.toEqual({ ok: true, value: [] })
  })

  it('turns a rejected transport call into a failure envelope instead of throwing', async () => {
    const face = createNativeModelsFace({ ...client({ modelsListProviders: async () => { throw new Error('host down') } }) }, signal)
    await expect(face.llm.listProviders()).resolves.toEqual({
      ok: false, error: { code: 'native/transport', message: 'host down' },
    })
  })

  it('writes settings and answers with the new revision', async () => {
    const face = createNativeModelsFace({ ...client() }, signal)
    const answer = await face.settings.mutate('llm-deepseek', [{ op: 'set', path: ['enabled'], value: true }], 3)
    expect(answer).toMatchObject({ ok: true, value: { ns: 'llm-deepseek', revision: 4 } })
  })

  it('describes credentials for the refs the page derives', async () => {
    const face = createNativeModelsFace({ ...client() }, signal)
    await expect(face.credentials.describe(['DEEPSEEK_API_KEY'])).resolves.toMatchObject({
      ok: true, value: { DEEPSEEK_API_KEY: { configured: true } },
    })
  })
})

describe('createNativeDescribeFace', () => {
  it('reads the whole document on ensure and publishes a ready view', async () => {
    const describe = createNativeDescribeFace({ ...client() }, signal)
    expect(describe.getSnapshot().status).toBe('idle')
    await describe.ensure()
    expect(describe.getSnapshot().status).toBe('ready')
    expect(describe.getSnapshot().view?.writable).toBe(true)
    expect(describe.getSnapshot().view?.namespaces.map(row => row.ns)).toEqual(['llm-deepseek'])
  })

  it('is idempotent once an answer is held', async () => {
    const read = vi.fn(async (): Promise<NativeSettingsDescription> => ({
      hasDocument: true, namespaces: [descriptor()],
      limits: { maxCredentialRefsPerRead: 64, maxSettingsOperations: 32 },
    }))
    const describe = createNativeDescribeFace({ ...client({ settingsDescribe: read }) }, signal)
    await describe.ensure()
    await describe.ensure()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('falls back to idle on a first-read failure so ensure retries', async () => {
    const describe = createNativeDescribeFace(
      { ...client({ settingsDescribe: async () => { throw new Error('unavailable') } }) }, signal,
    )
    await describe.ensure()
    expect(describe.getSnapshot().status).toBe('idle')
    expect(describe.getSnapshot().error).toBe('unavailable')
  })

  it('folds a write answer in without a second read', async () => {
    const describe = createNativeDescribeFace({ ...client() }, signal)
    await describe.ensure()
    describe.acceptView(toNamespaceView(descriptor({ revision: 9 })))
    expect(describe.getSnapshot().view?.namespaces[0]?.revision).toBe(9)
  })
})

describe('toDescribeView', () => {
  it('reports no view while the Host serves no namespace', () => {
    expect(toDescribeView([], false)?.namespaces).toEqual([])
    expect(toDescribeView([descriptor()], true)?.writable).toBe(true)
  })
})

describe('followInvalidations', () => {
  it('reports one notification per Host frame', async () => {
    const seen: string[] = []
    for await (const event of followInvalidations({ ...client() }, signal)) seen.push(event)
    expect(seen).toEqual(['llm/adapters-updated'])
  })
})

describe('resolveNativeSchema', () => {
  it('returns the settings domain base schema port when installed', () => {
    const schema = createSettingsSchemaOperations({
      rehydrate: () => ({}), validate: () => undefined, nodeAtPath: () => undefined,
      getPath: () => undefined, hasPath: () => false,
      setPath: root => root, deletePath: root => root,
    })
    expect(resolveNativeSchema({ schema })).toBe(schema)
  })

  it('reports an absent settings domain base instead of inventing one', () => {
    expect(resolveNativeSchema(undefined)).toBeUndefined()
  })
})
