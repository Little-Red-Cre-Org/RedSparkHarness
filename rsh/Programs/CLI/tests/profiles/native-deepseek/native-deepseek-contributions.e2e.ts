import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { runNativeProfile } from '../../../src/native-profile-boot.ts'

type JsonObject = Record<string, unknown>
type PersistedSession = { readonly header: JsonObject; readonly events: readonly JsonObject[] }
type NativeProfile = {
  formatVersion: 1
  scopes: Array<{ id: string; parent?: string }>
  installations: Array<{ id: string; plugin: string; scope: string; config?: unknown }>
}

function hasBuiltNativeProfileEntries(): boolean {
  const profilePath = new URL('../native-headless/rsh.profile.json', import.meta.url)
  const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as NativeProfile
  const packageNames = [
    ...profile.installations.map(row => row.plugin).filter(name => name.startsWith('@')),
    '@deepseek-ai/dsh-llm-deepseek',
    '@deepseek-ai/dsh-deepseek-llm-api-extensions',
    '@deepseek-ai/dsh-plugin-package-inventory-deepseek',
    '@deepseek-ai/dsh-session-log-deepseek',
    '@deepseek-ai/dsh-credentials-local',
    '@deepseek-ai/dsh-native-session-execution',
    '@deepseek-ai/dsh-native-sandbox-policy',
  ]
  const require = createRequire(import.meta.url)
  return packageNames.every((name) => {
    try { require.resolve(`${name}/native`); return true }
    catch (error) {
      if (isRecord(error) && error.code === 'MODULE_NOT_FOUND') return false
      throw error
    }
  })
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function readSessions(root: string): Promise<PersistedSession[]> {
  const sessions: PersistedSession[] = []
  const visit = async (directory: string): Promise<void> => {
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) }
    catch (error: unknown) {
      if (isRecord(error) && error.code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      const rows = (await readFile(path, 'utf8')).trimEnd().split(/\r?\n/u).map(line => JSON.parse(line) as unknown)
      const [header, ...events] = rows
      if (!isRecord(header) || header.type !== 'session' || events.some(event => !isRecord(event))) {
        throw new Error(`native-deepseek: invalid Session JSONL in ${path}`)
      }
      sessions.push({ header, events: events as JsonObject[] })
    }
  }
  await visit(root)
  return sessions
}

async function manifestVersion(packageName: string): Promise<string> {
  const path = createRequire(import.meta.url).resolve(`${packageName}/package.json`)
  const manifest = JSON.parse(await readFile(path, 'utf8')) as { version: string }
  return manifest.version
}

function field(request: JsonObject, name: string): unknown {
  const value = request[name]
  if (value === undefined) throw new Error(`native-deepseek: request omitted ${name}`)
  return value
}

function requestBody(request: IncomingMessage, response: ServerResponse, requests: JsonObject[]): void {
  const chunks: Buffer[] = []
  request.on('data', (chunk: Buffer) => chunks.push(chunk))
  request.on('end', () => {
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonObject)
    if (requests.length === 1) {
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end('{"error":{"message":"fixture unavailable","type":"server_error"}}')
      return
    }
    const events = [
      { choices: [{ delta: { role: 'assistant', content: null, reasoning_content: '' } }] },
      { choices: [{ delta: { content: 'native accepted' } }] },
      { choices: [{ delta: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } },
      '[DONE]',
    ]
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(events.map(event => `data: ${event === '[DONE]' ? event : JSON.stringify(event)}\n\n`).join(''))
  })
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => server.close((error) => {
    if (error === undefined) resolve()
    else reject(error)
  }))
}

it.skipIf(!hasBuiltNativeProfileEntries())('Native headless profile composition sends both contribution fields and durably accepts only the 2xx suffix', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-native-deepseek-'))
  const profileDir = join(home, 'profiles', 'native-headless')
  const workspace = join(home, 'workspace')
  const sessionsRoot = join(home, 'sessions')
  const appManifest = join(profileDir, 'package.json')
  const profilePath = join(profileDir, 'rsh.profile.json')
  const patchPath = join(home, 'deepseek.patch.json')
  const requests: JsonObject[] = []
  const server = createServer((request, response) => { requestBody(request, response, requests) })
  const previousExitCode = process.exitCode
  try {
    await mkdir(profileDir, { recursive: true })
    await mkdir(workspace, { recursive: true })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('native-deepseek: fixture server did not bind')
    const baseURL = `http://127.0.0.1:${address.port}/v1`
    const sourceProfilePath = fileURLToPath(new URL('../native-headless/rsh.profile.json', import.meta.url))
    const profile = JSON.parse(await readFile(sourceProfilePath, 'utf8')) as NativeProfile
    profile.scopes.push({ id: 'sibling', parent: 'root' })
    const model = profile.installations.find(row => row.id === 'model')
    if (model === undefined) throw new Error('native-deepseek: headless profile lost its model installation')
    model.plugin = '@deepseek-ai/dsh-llm-deepseek'
    model.config = { baseURL, models: [{ id: 'deepseek-v4-flash' }], thinking: 'disabled', reasoningEffort: 'off' }
    profile.installations.push(
      { id: 'credentials', plugin: '@deepseek-ai/dsh-credentials-local', scope: 'root' },
      { id: 'session-execution', plugin: '@deepseek-ai/dsh-native-session-execution', scope: 'root' },
      { id: 'deepseek-extensions', plugin: '@deepseek-ai/dsh-deepseek-llm-api-extensions', scope: 'root' },
      { id: 'package-inventory', plugin: '@deepseek-ai/dsh-plugin-package-inventory-deepseek', scope: 'root' },
      { id: 'session-log', plugin: '@deepseek-ai/dsh-session-log-deepseek', scope: 'root', config: { enabled: true } },
      { id: 'sibling-policy', plugin: '@deepseek-ai/dsh-native-sandbox-policy', scope: 'sibling',
        config: { mode: 'read-only', workspaceRoot: workspace } },
    )
    await writeFile(appManifest, JSON.stringify({ name: 'native-headless-profile', private: true,
      dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
    await writeFile(profilePath, JSON.stringify(profile))
    await writeFile(patchPath, JSON.stringify({ formatVersion: 1, installations: [
      { id: 'app', config: { cwd: workspace, provider: 'deepseek-official', model: 'deepseek-v4-flash',
        systemPrompt: 'Answer with the result.', maxSteps: 1, builtinTools: false } },
      { id: 'storage', config: { root: sessionsRoot, compression: 'none' } },
      { id: 'fs', config: { cwd: workspace } },
    ] }))
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DEEPSEEK_API_KEY', 'native-deepseek-fixture-key')

    let firstError: unknown
    try { await runNativeProfile({ profile: 'native-headless', patchFiles: [patchPath], args: ['first delivery'], home }) }
    catch (error) { firstError = error }
    expect(requests, `first profile run did not reach HTTP: ${String(firstError)}`).toHaveLength(1)
    expect(firstError).toMatchObject({ code: 'SERVER' })
    const firstPackages = field(requests[0]!, 'dsh_plugin_packages') as { packages: Array<{ name: string; version: string }> }
    const firstLog = field(requests[0]!, 'dsh_session_log') as { session: { id: string }; throughSeq: number; events: unknown[] }
    const sessionId = firstLog.session.id
    expect(firstLog.events.length).toBeGreaterThan(0)
    const selectedPackages = await Promise.all([
      '@deepseek-ai/dsh-plugin-package-inventory-deepseek',
      '@deepseek-ai/dsh-session-log-deepseek',
      '@deepseek-ai/dsh-llm-deepseek',
    ].map(async name => ({ name, version: await manifestVersion(name) })))
    expect(firstPackages.packages).toEqual(expect.arrayContaining(selectedPackages))
    expect(firstPackages.packages.map(item => item.name)).not.toContain('@deepseek-ai/dsh-native-sandbox-policy')
    const failedSession = (await readSessions(sessionsRoot)).find(item => item.header.id === sessionId)
    expect(failedSession?.events.some(event => event.type === 'session-log-deepseek/delivery-accepted')).toBe(false)

    await runNativeProfile({ profile: 'native-headless', patchFiles: [patchPath],
      args: ['--resume', sessionId, 'retry delivery'], home })
    expect(requests).toHaveLength(2)
    const secondLog = field(requests[1]!, 'dsh_session_log') as {
      session: { id: string }
      throughSeq: number
      afterSeq: number
      events: unknown[]
    }
    expect(secondLog.session.id).toBe(sessionId)
    expect(secondLog.afterSeq).toBe(-1)
    expect(secondLog.events.length).toBeGreaterThan(firstLog.events.length)
    const settledSession = (await readSessions(sessionsRoot)).find(item => item.header.id === sessionId)
    const marker = settledSession?.events.find(event => event.type === 'session-log-deepseek/delivery-accepted')
    expect(marker).toMatchObject({
      data: { sessionId, sessionFormatVersion: settledSession?.header.version, throughSeq: secondLog.throughSeq },
    })
    expect(Number(marker?.seq)).toBeGreaterThan(secondLog.throughSeq)
  } finally {
    try { await closeServer(server) }
    finally {
      process.exitCode = previousExitCode
      vi.unstubAllEnvs()
      await rm(home, { recursive: true, force: true })
    }
  }
})
