import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { spawn, type ChildProcess, type Serializable } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

it('persists owner metadata in a versioned sidecar without exposing it as a credential record', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-native-credentials-metadata-'))
  roots.push(root)
  const filename = join(root, '.credentials.yaml')
  const key = credentialKey('llm-pi-ai', 'openai-codex')
  const provider = new NativeLocalCredentialProvider({
    environment: () => createLaunchEnvironmentSnapshot([]),
    logger: { info() {}, warn() {}, error() {} },
    referenceUpdated() {},
  }, { path: filename, watch: false })
  await provider.start()
  try {
    const metadata = { extAgentHostId: 'host-fixture', clientId: 'client-fixture' }
    await expect(provider.modifyMetadata(key, async current => current ?? metadata)).resolves.toEqual(metadata)
    await expect(provider.readMetadata(key)).resolves.toEqual(metadata)
    await expect(provider.listRecords()).resolves.toEqual([])
    await expect(readFile(`${filename}.metadata.json`, 'utf8')).resolves.toBe(
      '{\n  "version": 1,\n  "entries": {\n    "llm-pi-ai/openai-codex": {\n      "extAgentHostId": "host-fixture",\n      "clientId": "client-fixture"\n    }\n  }\n}\n',
    )
    await provider.modifyMetadata(key, async (current) => {
      const value = current as { extAgentHostId: string; clientId: string }
      value.clientId = 'client-mutated-fixture'
      return value
    })
    const edited = JSON.parse(await readFile(`${filename}.metadata.json`, 'utf8')) as {
      entries: Record<string, { clientId: string }>
    }
    expect(edited.entries[key]?.clientId).toBe('client-mutated-fixture')
    await provider.modifyRecord(key, async () => ({ kind: 'api-key', key: 'legacy-fixture' }))
    const unrelatedKey = credentialKey('other-owner', 'unrelated-record')
    const unrelated = { kind: 'api-key' as const, key: 'sibling-original-fixture' }
    await provider.modifyRecord(unrelatedKey, async () => unrelated)
    await provider.migrateRecordToMetadata(key, async (current, _legacy, readRecord) => {
      const value = current as { extAgentHostId: string; clientId: string }
      value.extAgentHostId = 'host-migrated-fixture'
      const sibling = readRecord(unrelatedKey) as { kind: 'api-key'; key: string }
      sibling.key = 'sibling-mutated-fixture'
      return { value, retireRecord: true }
    })
    const migrated = JSON.parse(await readFile(`${filename}.metadata.json`, 'utf8')) as {
      entries: Record<string, { extAgentHostId: string; clientId: string }>
    }
    expect(migrated.entries[key]).toEqual({
      extAgentHostId: 'host-migrated-fixture', clientId: 'client-mutated-fixture',
    })
    await expect(provider.readRecord(key)).resolves.toBeUndefined()
    await expect(provider.readRecord(unrelatedKey)).resolves.toEqual(unrelated)
  } finally {
    await provider.dispose()
  }
})

it('serializes two independent migration workers and preserves the first durable registration identity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-native-credentials-migration-'))
  roots.push(root)
  const filename = join(root, '.credentials.yaml')
  const key = credentialKey('llm-pi-ai', 'openai-codex-siwc-registration')
  const environment = createLaunchEnvironmentSnapshot([])
  const unrelatedKey = credentialKey('other-owner', 'unrelated-record')
  const provider = new NativeLocalCredentialProvider({
    environment: () => environment,
    logger: { info() {}, warn() {}, error() {} },
    referenceUpdated() {},
  }, { path: filename, watch: false })
  await provider.start()
  try {
    const legacy = { kind: 'api-key' as const, key: 'legacy-registration-fixture' }
    await provider.modifyRecord(key, async () => legacy)
    await provider.modifyRecord(unrelatedKey, async () => ({ kind: 'api-key', key: 'preserved-fixture' }))
  } finally {
    await provider.dispose()
  }

  const fixture = fileURLToPath(new URL('./fixtures/metadata-migration-worker.ts', import.meta.url))
  const launchWorker = (role: 'holder' | 'contender', candidate: string): ChildProcess => {
    const env = Object.fromEntries(Object.entries(process.env)
      .filter(([name, value]) => value !== undefined && !/(KEY|SECRET|TOKEN|PASSWORD)/i.test(name)))
    env.TSX_TSCONFIG_PATH = join(process.cwd(), 'tsconfig.base.json')
    // The child maps workspace imports to source so each process uses this provider implementation.
    return spawn(process.execPath, ['--import', import.meta.resolve('tsx/esm'), fixture, role, filename, candidate], {
      cwd: process.cwd(), env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true,
    })
  }
  const children: ChildProcess[] = []
  const waitForMessage = (child: ChildProcess, expected: string): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
    const finish = (error?: Error, message?: Record<string, unknown>): void => {
      clearTimeout(timeout)
      child.off('message', receive)
      child.off('error', fail)
      child.off('close', closed)
      if (error !== undefined) reject(error)
      else resolve(message!)
    }
    const timeout = setTimeout(() => { finish(new Error(`worker did not send ${expected}`)) }, 20_000)
    const receive = (message: unknown): void => {
      if (message === null || typeof message !== 'object') return
      const record = message as Record<string, unknown>
      if (record.type === 'error') finish(new Error(String(record.message)))
      else if (record.type === expected) finish(undefined, record)
    }
    const fail = (error: Error): void => { finish(error) }
    const closed = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish(new Error(`worker closed before ${expected} (code ${code}, signal ${signal})`))
    }
    child.on('message', receive)
    child.on('error', fail)
    child.on('close', closed)
    if (child.exitCode !== null || child.signalCode !== null) {
      closed(child.exitCode, child.signalCode)
    }
  })
  type WorkerExit = { timedOut: true } | { code: number | null; signal: NodeJS.Signals | null }
  const waitForExit = (child: ChildProcess): Promise<WorkerExit> => new Promise((resolve) => {
    const finish = (result: WorkerExit): void => {
      clearTimeout(timeout)
      child.off('close', closed)
      resolve(result)
    }
    const timeout = setTimeout(() => { finish({ timedOut: true }) }, 20_000)
    const closed = (code: number | null, signal: NodeJS.Signals | null): void => { finish({ code, signal }) }
    child.once('close', closed)
  })
  const send = (child: ChildProcess, message: Serializable): Promise<void> => new Promise((resolve, reject) => {
    child.send(message, (error) => {
      if (error === null) resolve()
      else reject(error)
    })
  })
  const exits: Promise<WorkerExit>[] = []
  try {
    const holder = launchWorker('holder', 'host-candidate-a')
    children.push(holder)
    exits.push(waitForExit(holder))
    await expect(waitForMessage(holder, 'entered')).resolves.toMatchObject({ role: 'holder' })
    expect(existsSync(`${filename}.lock`)).toBe(true)

    const contender = launchWorker('contender', 'host-candidate-b')
    children.push(contender)
    exits.push(waitForExit(contender))
    await expect(waitForMessage(contender, 'attempting')).resolves.toMatchObject({ role: 'contender' })
    expect(existsSync(`${filename}.lock`)).toBe(true)
    const completed = Promise.all([
      waitForMessage(holder, 'completed'),
      waitForMessage(contender, 'completed'),
    ])
    const [results] = await Promise.all([completed, send(holder, { type: 'release' })])
    const [holderResult, contenderResult] = results
    expect(holderResult).toMatchObject({ hostId: 'host-candidate-a', legacyRetired: true, unrelatedRecordPreserved: true })
    expect(contenderResult).toMatchObject({ hostId: 'host-candidate-a', legacyRetired: true, unrelatedRecordPreserved: true })
    expect(await Promise.all(exits)).toEqual([{ code: 0, signal: null }, { code: 0, signal: null }])
    expect(existsSync(`${filename}.lock`)).toBe(false)
    const finalProvider = new NativeLocalCredentialProvider({
      environment: () => environment,
      logger: { info() {}, warn() {}, error() {} },
      referenceUpdated() {},
    }, { path: filename, watch: false })
    await finalProvider.start()
    try {
      await expect(finalProvider.readMetadata(key)).resolves.toEqual({ extAgentHostId: 'host-candidate-a' })
      await expect(finalProvider.readRecord(key)).resolves.toBeUndefined()
      await expect(finalProvider.readRecord(unrelatedKey)).resolves.toEqual({ kind: 'api-key', key: 'preserved-fixture' })
    } finally {
      await finalProvider.dispose()
    }
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill()
    await Promise.all(children.map(child => new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve()
      else child.once('close', () => { resolve() })
    })))
    await Promise.allSettled(exits)
  }
})

it('preserves a legacy record when its metadata sidecar cannot be read', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-native-credentials-preserve-migration-'))
  roots.push(root)
  const filename = join(root, '.credentials.yaml')
  const key = credentialKey('llm-pi-ai', 'openai-codex-siwc-registration')
  const legacy = { kind: 'api-key' as const, key: 'legacy-registration-fixture' }
  const provider = new NativeLocalCredentialProvider({
    environment: () => createLaunchEnvironmentSnapshot([]),
    logger: { info() {}, warn() {}, error() {} },
    referenceUpdated() {},
  }, { path: filename, watch: false })
  await provider.start()
  try {
    await provider.modifyRecord(key, async () => legacy)
    await writeFile(`${filename}.metadata.json`, '{broken')
    await expect(provider.migrateRecordToMetadata(key, async () => ({
      value: { extAgentHostId: 'must-not-replace-source' }, retireRecord: true,
    }))).rejects.toThrow(/invalid JSON/)
    await expect(provider.readRecord(key)).resolves.toEqual(legacy)
  } finally {
    await provider.dispose()
  }
})
