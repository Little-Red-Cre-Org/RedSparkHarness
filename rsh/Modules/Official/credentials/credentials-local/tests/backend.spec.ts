import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials/native'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment/native'
import { NativeLocalCredentialProvider } from '../src/backend.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('persists native reference and record operations through the shared file backend', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-native-credentials-'))
  roots.push(root)
  const filename = join(root, '.credentials.yaml')
  const ref = credentialRef('DEEPSEEK_API_KEY')
  const key = credentialKey('llm-deepseek', 'deepseek-official')
  const updated: string[] = []
  const environment = createLaunchEnvironmentSnapshot([{ source: 'project-env', values: { DEEPSEEK_API_KEY: 'fallback' } }])
  const provider = new NativeLocalCredentialProvider({
    environment: () => environment,
    logger: { info() {}, warn() {}, error() {} },
    referenceUpdated: (changed) => { updated.push(changed) },
    recordUpdated: (changed) => { updated.push(changed) },
  }, { path: filename, watch: false })
  await provider.start()
  try {
    expect(await provider.resolve(ref)).toEqual({ value: 'fallback', source: 'project-env' })
    await provider.set(ref, 'stored')
    expect(await provider.resolve(ref)).toEqual({ value: 'stored', source: 'file' })
    await provider.modifyRecord(key, async () => ({ kind: 'api-key', key: 'record-secret' }))
    expect(await provider.readRecord(key)).toEqual({ kind: 'api-key', key: 'record-secret' })
    expect(updated).toEqual([ref, key])
    const document = await readFile(filename, 'utf8')
    expect(document).toContain('DEEPSEEK_API_KEY: stored')
    expect(document).toContain('record-secret')
  } finally {
    await provider.dispose()
  }
  await expect(provider.set(ref, 'late')).rejects.toThrow(/disposed/)
})
