import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentPresetRegistry } from '@deepseek-ai/dsh-agent-presets/native'
import { NativeWebSettingsEvents } from '../src/settings-events.ts'
import { NativeWebSessionService, resolveNativeWebSessionConfig } from '../src/native.ts'
import type { NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import type { NativeActiveSessionOperations } from '@deepseek-ai/dsh-native-session-execution'

it('reads, copies and deletes native preset folders and publishes each roster update', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-native-agent-presets-'))
  const systemRoot = join(home, 'system')
  const userRoot = join(home, '.agent-presets')
  const source = join(systemRoot, 'standard')
  const unavailable = join(systemRoot, 'unavailable')
  const content = '{"formatVersion":1,"installations":[]}'
  const signal = new AbortController().signal
  const registry = new NativeAgentPresetRegistry('standard', new NativeScope(), [
    { id: 'unavailable', name: 'Unavailable', trust: 'system', status: 'invalid', problem: 'Plugin is missing.' },
  ], [
    { path: systemRoot, trust: 'system' }, { path: userRoot, trust: 'user' },
  ])
  const settingsEvents = new NativeWebSettingsEvents({
    signal,
    on: () => () => Promise.resolve(),
  })
  const config = resolveNativeWebSessionConfig({ cwd: home, provider: 'fixture', model: 'fixture', systemPrompt: 'Answer.',
    maxSteps: 1, builtinTools: false, maxPendingRequests: 1, maxHistoryEvents: 10, maxPromptChars: 100,
    maxFollowBufferBytes: 1000, maxFollowers: 1, maxPendingHumanRequests: 1 })
  const service = new NativeWebSessionService(
    { dispose: async () => {} } as unknown as NativeHeadlessApplication,
    {} as NativeSessionPersistenceOperations, {} as NativeActiveSessionOperations,
    config, signal, { presets: registry }, () => { settingsEvents.agentPresetsUpdated() },
  )
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'agent.native.json'), content)
    await writeFile(join(source, 'preset.yml'), 'name: Standard\ndescription: Source description.\norder: 1\n')
    await mkdir(unavailable, { recursive: true })
    await writeFile(join(unavailable, 'agent.native.json'), content)
    const response = await settingsEvents.stream(new Request('http://localhost/api/native-session/settings-events', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }))
    reader = response.body!.getReader()

    expect(await service.handle('agent-presets/read', { id: 'standard' }, signal)).toEqual({ ok: true, value: {
      id: 'standard', source: 'system', status: 'ready', name: 'Standard', description: 'Source description.', content,
    } })
    expect(await service.handle('agent-presets/read', { id: 'unavailable' }, signal)).toMatchObject({ ok: true, value: {
      id: 'unavailable', source: 'system', status: 'invalid', problem: 'Plugin is missing.', content,
    } })
    expect(await service.handle('agent-presets/copy', { from: 'standard', id: 'standard' }, signal))
      .toMatchObject({ ok: false, error: { code: 'agent-preset/invalid' } })
    expect(await service.handle('agent-presets/copy', { from: 'standard', id: 'mine', name: 'Mine' }, signal))
      .toEqual({ ok: true, value: { updated: true } })
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: {"type":"agent-presets/updated"}\n\n')
    expect(await service.handle('agent-presets/read', { id: 'mine' }, signal)).toMatchObject({ ok: true, value: {
      id: 'mine', source: 'user', status: 'ready', name: 'Mine', description: 'Source description.', content,
    } })
    expect(await service.handle('agent-presets/delete', { id: 'standard' }, signal)).toMatchObject({
      ok: false, error: { code: 'agent-preset/read-only' },
    })
    expect(await service.handle('agent-presets/delete', { id: 'mine' }, signal))
      .toEqual({ ok: true, value: { updated: true } })
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: {"type":"agent-presets/updated"}\n\n')
    expect(registry.catalog().folders.map(folder => folder.id)).toEqual(['standard', 'unavailable'])
  } finally {
    await reader?.cancel()
    await settingsEvents.close()
    await service.close()
    await registry.dispose()
    await rm(home, { recursive: true, force: true })
  }
})
