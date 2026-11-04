// @vitest-environment jsdom
/**
 * Native model-selection face.
 *
 * The browser half owns a `/model` popup and the composer seat over one
 * per-Session directory. The Native half publishes the same catalog and
 * selection as `clientNativeModelSelection`; this suite pins the read, the
 * shared in-flight load, the failure passthrough, and the row flattening both
 * pickers render.
 */
import { describe, expect, it, vi } from 'vitest'
import type { NativeModelControls } from '@redspark/rsh-client-native-session/native'
import type { SessionId } from '@redspark/rsh-session/types'
import { createNativeModelSelection } from '../src/native.ts'
import { en, zh } from '../src/client/locales.ts'

const SID = 'model-session' as SessionId

function controls(overrides: Partial<NativeModelControls> = {}): NativeModelControls {
  return {
    catalog: {
      default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      routableProviders: ['deepseek-official'],
      groups: [{
        id: 'deepseek-official',
        name: 'DeepSeek',
        models: [
          { id: 'deepseek-v4-flash', name: 'V4 Flash' },
          {
            id: 'deepseek-v4-pro',
            name: 'V4 Pro',
            description: 'Deep reasoning',
            reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' },
          },
        ],
      }],
      failures: [{ id: 'broken', name: 'Broken provider', message: 'connection refused' }],
    },
    canSelectModel: true,
    presets: [],
    ...overrides,
  }
}

function client(named: { readonly value?: NativeModelControls; readonly failure?: Error } = {}) {
  return {
    modelControls: vi.fn(async () => {
      if (named.failure !== undefined) throw named.failure
      return named.value ?? controls()
    }),
    selectModel: vi.fn(async () => {}),
  }
}

describe('native model selection', () => {
  it('reads the Host catalog once and shares the in-flight load', async () => {
    const fake = client()
    const service = createNativeModelSelection(fake as never, new AbortController().signal)
    const [first, second] = await Promise.all([service.load(), service.load()])
    expect(fake.modelControls).toHaveBeenCalledOnce()
    expect(first).toBe(second)
    expect(service.getSnapshot().status).toBe('ready')
    expect(service.getSnapshot().canSelect).toBe(true)
  })

  it('reuses a loaded catalog instead of reading again', async () => {
    const fake = client()
    const service = createNativeModelSelection(fake as never, new AbortController().signal)
    await service.load()
    await service.load()
    expect(fake.modelControls).toHaveBeenCalledOnce()
  })

  it('re-reads on refresh even after a good read', async () => {
    const fake = client()
    const service = createNativeModelSelection(fake as never, new AbortController().signal)
    await service.load()
    await service.refresh()
    expect(fake.modelControls).toHaveBeenCalledTimes(2)
  })

  it('reports a failed read without pretending the catalog is empty', async () => {
    const fake = client({ failure: new Error('connection reset') })
    const service = createNativeModelSelection(fake as never, new AbortController().signal)
    await service.load()
    expect(service.getSnapshot().status).toBe('error')
    expect(service.getSnapshot().error).toBe('connection reset')
    expect(service.getSnapshot().catalog).toBeNull()
    expect(service.rows()).toEqual([])
  })

  it('flattens groups into provider/model rows and appends failure rows', async () => {
    const service = createNativeModelSelection(client() as never, new AbortController().signal)
    await service.load()
    const rows = service.rows()
    expect(rows.map(row => row.id)).toEqual([
      'deepseek-official/deepseek-v4-flash',
      'deepseek-official/deepseek-v4-pro',
      'failure/broken',
    ])
    const pro = rows[1]
    expect(pro?.efforts).toEqual(['low', 'high'])
    expect(pro?.defaultEffort).toBe('high')
  })

  it('localizes a failure row through this plugin own copy', async () => {
    const service = createNativeModelSelection(client() as never, new AbortController().signal)
    await service.load()
    const translate = (key: keyof typeof zh, params?: Record<string, unknown>): string =>
      (zh[key] ?? key).replace('{message}', String(params?.message ?? ''))
    const failure = service.rows(translate).at(-1)
    expect(failure?.description).toBe(zh['option.loadError'].replace('{message}', 'connection refused'))
  })

  it('forwards a selection with the addressed Session', async () => {
    const fake = client()
    const service = createNativeModelSelection(fake as never, new AbortController().signal)
    await service.select(SID, { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' })
    expect(fake.selectModel).toHaveBeenCalledWith(
      SID,
      { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
      expect.any(AbortSignal),
    )
  })
})

describe('native model dictionaries', () => {
  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
