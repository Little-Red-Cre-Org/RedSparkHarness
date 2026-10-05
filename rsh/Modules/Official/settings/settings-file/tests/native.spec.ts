import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeSettings } from '@deepseek-ai/dsh-settings/native'
import type { NativeModel } from '@deepseek-ai/dsh-native-model-execution'
import { createLaunchEnvironmentSnapshot, launchEnvironmentProvider } from '@deepseek-ai/dsh-launch-environment/native'
import { plugin as credentials } from '@deepseek-ai/dsh-credentials-local/native'
import { plugin as piAi } from '@deepseek-ai/dsh-llm-pi-ai/native'
import { plugin as fileSettings } from '../src/native.ts'

it('keeps unrelated YAML fields and comments while rejecting a stale or invalid write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-settings-'))
  const filename = join(root, 'settings.yaml')
  await writeFile(filename, '# user notes\neditor:\n  theme: light\nunloaded:\n  keep: true\n')
  const scope = new NativeScope()
  let settings: NativeSettings | undefined
  const consumer: NativePlugin = {
    apiVersion: 1, name: 'settings-reader', targets: ['host'], requires: ['settings'], provides: [],
    resolve: () => (context) => { settings = context.require('settings') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined },
    { plugin: fileSettings, scope, config: { path: filename, watch: false } },
  ], 'host'))
  try {
    await host.start()
    if (settings === undefined) throw new Error('native settings service missing')
    const editor = settings.register('editor', { theme: 'base' }, (value) => {
      if (typeof value['theme'] !== 'string') throw new Error('theme must be a string')
      return { theme: value['theme'] }
    })
    await editor.update({ theme: 'dark' }, 0)
    await expect(editor.update({ theme: 'stale' }, 0)).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
    await expect(editor.update({ theme: 3 })).rejects.toThrow('theme must be a string')
    const text = await readFile(filename, 'utf8')
    expect(text).toContain('# user notes')
    expect(text).toContain('unloaded:\n  keep: true')
    expect(editor.get()).toEqual({ theme: 'dark' })
    await writeFile(filename, 'editor: [invalid\n')
    await expect(settings.reload()).rejects.toThrow('invalid YAML document')
    await expect(editor.update({ theme: 'blocked' })).rejects.toThrow('invalid YAML document')
    expect(editor.get()).toEqual({ theme: 'dark' })
  } finally {
    await host.stop()
    await rm(root, { recursive: true, force: true })
  }
})

it('publishes a stored pi-ai route to the next native model resolution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-model-settings-'))
  const scope = new NativeScope()
  let settings: NativeSettings | undefined
  let model: NativeModel | undefined
  const consumer: NativePlugin = {
    apiVersion: 1, name: 'model-settings-reader', targets: ['host'], requires: ['settings', 'model'], provides: [],
    resolve: () => (context) => {
      settings = context.require('settings')
      model = context.require('model')
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined },
    { plugin: fileSettings, scope, config: { path: join(root, 'settings.yaml'), watch: true, debounceMs: 10 } },
    { plugin: credentials, scope, config: { path: join(root, '.credentials.yaml'), watch: false } },
    { plugin: launchEnvironmentProvider(createLaunchEnvironmentSnapshot([])), scope, config: undefined },
    { plugin: piAi, scope, config: { providers: {} } },
  ], 'host'))
  try {
    await host.start()
    if (settings === undefined || model === undefined) throw new Error('native model settings composition missing')
    const route = settings.register('test-reader', {}, value => value)
    await route.update({ enabled: true })
    await writeFile(join(root, 'settings.yaml'), 'llm-pi-ai:\n  providers:\n    stored:\n      api: openai-completions\n      baseURL: https://example.invalid/v1\n      models:\n        - id: stored-model\n')
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        await model.resolveModel?.('stored', 'stored-model')
        break
      } catch {
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }
    await expect(model.resolveModel?.('stored', 'stored-model')).resolves.toMatchObject({ provider: 'stored', id: 'stored-model' })
  } finally {
    await host.stop()
    await rm(root, { recursive: true, force: true })
  }
})
