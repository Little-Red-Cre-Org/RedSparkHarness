import { expect, it } from 'vitest'
import z from '@deepseek-ai/schemastery'
import { NativeSettings } from '../src/native.ts'
import type { NativeSettingsSection } from '../src/native.ts'

it('publishes schema-backed redacted native views and preserves hidden fields during revisioned edits', async () => {
  let document: NativeSettingsSection = {
    profiles: {
      routes: { alpha: { apiKeyEnv: 'ALPHA_KEY', storedSecret: 'must-not-cross', enabled: true } },
      rows: [{ enabled: true, privateValue: 'array-secret-must-stay' }],
    },
  }
  const settings = new NativeSettings({
    load: async () => document,
    persist: async (update) => { document = update(document); return document },
  })
  await settings.start()
  const schema = z.object({
    routes: z.dict(z.object({
      apiKeyEnv: z.string().role('credential-ref'),
      storedSecret: z.string().role('secret').default('schema-secret-must-not-cross'),
      enabled: z.boolean(),
    })),
    rows: z.array(z.object({ enabled: z.boolean(), privateValue: z.string().role('secret') })),
  }).default({
    routes: { alpha: { apiKeyEnv: 'ALPHA_KEY', storedSecret: 'nested-schema-default-must-not-cross', enabled: true } },
    rows: [{ enabled: true, privateValue: 'array-schema-default-must-not-cross' }],
  })
  const scope = settings.register('profiles', {}, value => schema(value), undefined, { schema })
  settings.register('internal', {}, value => value)
  const unsafeSchema = z.object({ choice: z.union([z.string().role('secret'), z.number()]) })
  expect(() => settings.register('unsafe', {}, value => unsafeSchema(value), undefined, { schema: unsafeSchema }))
    .toThrow('secret fields to use object, dict, or array paths')

  const [view] = settings.describe()
  expect(settings.describe()).toHaveLength(1)
  expect(view).toMatchObject({ namespace: 'profiles', credentialRefs: ['ALPHA_KEY'], revision: 0 })
  expect(JSON.stringify(view)).not.toContain('must-not-cross')
  expect(JSON.stringify(view?.schema)).not.toContain('schema-secret-must-not-cross')
  expect(JSON.stringify(view?.schema)).not.toContain('nested-schema-default-must-not-cross')
  expect(JSON.stringify(view?.schema)).not.toContain('"default"')
  expect(view?.secrets).toEqual([
    { path: ['routes', 'alpha', 'storedSecret'], set: true },
    { path: ['rows', '0', 'privateValue'], set: true },
  ])
  expect(JSON.stringify(view)).not.toContain('array-secret-must-stay')

  await expect(settings.mutate('profiles', [
    { op: 'set', path: ['routes', 'alpha', 'storedSecret'], value: 'must-stay-out-of-settings' },
  ], 0)).rejects.toThrow('secret fields cannot be edited')
  await expect(settings.mutate('internal', [{ op: 'set', path: ['enabled'], value: true }], 0))
    .rejects.toThrow('not published for native editing')
  expect(document.profiles).toMatchObject({ routes: { alpha: { enabled: true, storedSecret: 'must-not-cross' } } })

  await settings.mutate('profiles', [{ op: 'set', path: ['routes', 'alpha', 'enabled'], value: false }], 0)
  await settings.mutate('profiles', [{ op: 'set', path: ['rows', '0', 'enabled'], value: false }], 1)
  expect(document.profiles).toMatchObject({
    routes: { alpha: { enabled: false, storedSecret: 'must-not-cross' } },
    rows: [{ enabled: false, privateValue: 'array-secret-must-stay' }],
  })
  expect(scope.get()).toMatchObject({ routes: { alpha: { enabled: false } }, rows: [{ enabled: false }] })
  await expect(settings.mutate('profiles', [{ op: 'set', path: ['rows', '0'], value: { enabled: true } }], 2))
    .rejects.toThrow('secret fields cannot be edited')
  await expect(settings.mutate('profiles', [], 1)).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT', expected: 1, actual: 2 })
  await expect(settings.mutate('profiles', [{ op: 'set', path: ['routes', 'alpha', 'enabled'], value: 'invalid' }], 2)).rejects.toThrow()
  expect(scope.revision).toBe(2)
  await settings.dispose()
})
