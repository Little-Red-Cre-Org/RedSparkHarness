/** Packed-consumer coverage for a Session written through the explicit Cordis bridge. */
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { isAbsolute, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'

const PACKED_BIN = process.env.DSH_PACKED_DSH_BIN
const CONSUMER_ROOT = process.env.DSH_PACKED_CONSUMER_ROOT
const SESSION_ID = 'packed-native-compat-bridge'
const FIRST_TASK = 'Write the requested marker file.'
const SECOND_TASK = 'Read the marker file in this existing session.'
const TOOL_CALL_ID = 'write-packed-compat-bridge'
const READ_CALL_ID = 'read-packed-compat-bridge'
const FILE_PATH = 'compat-bridge-marker.txt'
const MARKER = 'PACKED_COMPAT_BRIDGE_MARKER_6d13f8'
const MODEL = 'packed-compat-bridge-fixture'
const FIRST_REPLY = 'compatibility bridge wrote the marker'
const SECOND_REPLY = 'native filesystem read the marker'

type JsonObject = Record<string, unknown>
type RunResult = { readonly sessionId: string; readonly finalResponse: string; readonly events: JsonObject[] }
type InstalledSdk = {
  DeepSeekHarness: new (options: {
    readonly profile: 'native-sdk'
    readonly dshBin: string
    readonly dshHome: string
    readonly patches: string[]
    readonly cwd: string
    readonly provider: 'fixture'
    readonly model: string
    readonly env: NodeJS.ProcessEnv
    readonly requestTimeoutMs: number
  }) => {
    session(sessionId: string): { run(input: string): Promise<RunResult> }
    close(): Promise<void>
  }
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function writeSse(response: ServerResponse, value: unknown): void {
  response.write('data: ' + JSON.stringify(value) + '\n\n')
}

function respondWithText(response: ServerResponse, text: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  writeSse(response, { choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
  response.end('data: [DONE]\n\n')
}

function respondWithToolCall(response: ServerResponse, id: string, name: string, args: JsonObject): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  writeSse(response, { choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: 'function',
    function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
  response.end('data: [DONE]\n\n')
}

function toolResults(events: readonly JsonObject[], callId: string): JsonObject[] {
  return events.flatMap((event) => {
    if (event.type !== 'tool/result' || !isRecord(event.data) || !isRecord(event.data.message)
      || !isRecord(event.data.message.source) || event.data.message.source.callId !== callId
      || !Array.isArray(event.data.message.content)) return []
    return event.data.message.content.filter((block): block is JsonObject => isRecord(block)
      && block.type === 'tool-result' && block.toolCallId === callId)
  })
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
}

it.skipIf(PACKED_BIN === undefined || CONSUMER_ROOT === undefined)(
  'runs the installed SDK through the Cordis bridge, then resumes its Session with native filesystem tools',
  async () => {
    const consumerRoot = CONSUMER_ROOT
    const packedBin = PACKED_BIN
    if (consumerRoot === undefined || packedBin === undefined) throw new Error('packed consumer variables are missing')
    const installedRoot = await realpath(consumerRoot)
    const installedBin = await realpath(packedBin)
    const binRelative = relative(installedRoot, installedBin)
    expect(binRelative.startsWith('..' + sep) || isAbsolute(binRelative)).toBe(false)
    expect(binRelative.split(sep)).toEqual(['node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'])
    const consumerRequire = createRequire(join(installedRoot, 'package.json'))
    const sdkClientPath = await realpath(consumerRequire.resolve('@deepseek-ai/dsh-sdk-client'))
    const sdkRelative = relative(installedRoot, sdkClientPath)
    expect(sdkRelative.startsWith('..' + sep) || isAbsolute(sdkRelative)).toBe(false)
    expect(sdkRelative.split(sep).slice(0, 3)).toEqual(['node_modules', '@deepseek-ai', 'dsh-sdk-client'])
    for (const packageName of [
      '@deepseek-ai/dsh-compat-dsh-runtime',
      '@deepseek-ai/dsh-compat-fs-local',
      '@deepseek-ai/dsh-compat-fs-policy',
      '@deepseek-ai/dsh-compat-tool-fs',
      '@deepseek-ai/cordis',
      '@deepseek-ai/cordis-plugin-loader',
    ]) {
      const packagePath = await realpath(consumerRequire.resolve(packageName + '/package.json'))
      const packageRelative = relative(installedRoot, packagePath)
      expect(packageRelative.startsWith('..' + sep) || isAbsolute(packageRelative)).toBe(false)
    }
    const { DeepSeekHarness } = await import(pathToFileURL(sdkClientPath).href) as InstalledSdk

    const root = await mkdtemp(join(installedRoot, '.dsh-p4-compat-bridge-'))
    const home = join(root, 'home')
    const workspace = join(root, 'workspace')
    const sessionsRoot = join(home, 'sessions')
    const patch = join(root, 'fixture.patch.json')
    let server: ReturnType<typeof createServer> | undefined
    try {
      await mkdir(workspace, { recursive: true })
      const childEnv: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1',
        PACKED_COMPAT_FIXTURE_KEY: 'packed-local-fixture-key' }
      delete childEnv.NODE_OPTIONS
      delete childEnv.NODE_PATH
      delete childEnv.DEEPSEEK_BASE_URL
      const profileDump = await execa(process.execPath, [installedBin, '--profile', 'native-sdk', '--dump-config'], {
        cwd: workspace, env: childEnv, extendEnv: false, reject: false, timeout: 30_000,
      })
      expect(profileDump.timedOut, profileDump.stderr).toBe(false)
      expect(profileDump.exitCode, profileDump.stderr).toBe(0)
      const profileConfig = join(home, 'profiles', 'native-sdk', 'rsh.profile.json')
      const composition = JSON.parse(await readFile(profileConfig, 'utf8')) as { installations: JsonObject[] }
      expect(composition.installations.filter(row => row.id === 'fs')).toEqual([
        { id: 'fs', plugin: '@deepseek-ai/dsh-fs-local', scope: 'root' }])
      expect(composition.installations.some(row => row.id === 'policy' || row.id === 'file-tools')).toBe(false)
      const others = composition.installations.filter(row => row.id !== 'fs')
      const bridgeProfile = JSON.stringify({ ...composition, installations: [...others,
        { id: 'compat-dsh-runtime', plugin: '@deepseek-ai/dsh-compat-dsh-runtime', scope: 'root', config: {} },
        { id: 'fs', plugin: '@deepseek-ai/dsh-compat-fs-local', scope: 'root', config: { cwd: workspace } },
        { id: 'policy', plugin: '@deepseek-ai/dsh-compat-fs-policy', scope: 'root', config: {} },
        { id: 'file-tools', plugin: '@deepseek-ai/dsh-compat-tool-fs', scope: 'root',
          config: { readLimit: 200, readMaxLineLength: 2_000, readMaxBytes: 16_000, readStreamMinSize: 128_000 } },
      ] })
      const nativeProfile = JSON.stringify({ ...composition, installations: [...others,
        { id: 'fs', plugin: '@deepseek-ai/dsh-fs-local', scope: 'root' },
        { id: 'policy', plugin: '@deepseek-ai/dsh-fs-observation-policy', scope: 'root' },
        { id: 'file-tools', plugin: '@deepseek-ai/dsh-tool-fs', scope: 'root' },
      ] })
      await writeFile(profileConfig, bridgeProfile)

      const requests: JsonObject[] = []
      const modelServer = createServer((request: IncomingMessage, response: ServerResponse) => {
        let body = ''
        request.setEncoding('utf8')
        request.on('data', (chunk: string) => { body += chunk })
        request.on('end', () => {
          if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
            response.writeHead(404).end()
            return
          }
          const parsed = JSON.parse(body) as unknown
          if (!isRecord(parsed)) {
            response.writeHead(400).end()
            return
          }
          requests.push(parsed)
          if (requests.length === 1) respondWithToolCall(response, TOOL_CALL_ID, 'write', { file_path: FILE_PATH, content: MARKER })
          else if (requests.length === 3) respondWithToolCall(response, READ_CALL_ID, 'read', { file_path: FILE_PATH })
          else respondWithText(response, requests.length === 2 ? FIRST_REPLY : SECOND_REPLY)
        })
      })
      server = modelServer
      await new Promise<void>((resolve, reject) => {
        modelServer.once('error', reject)
        modelServer.listen(0, '127.0.0.1', () => { modelServer.removeListener('error', reject); resolve() })
      })
      const address = modelServer.address()
      if (address === null || typeof address === 'string') throw new Error('packed-compat-bridge: model fixture did not bind')
      const baseURL = `http://127.0.0.1:${address.port}/v1`
      await writeFile(patch, JSON.stringify({ formatVersion: 1, installations: [
        { id: 'app', config: { systemPrompt: 'Use the requested filesystem tool, then report the result.', maxSteps: 3 } },
        { id: 'storage', config: { root: sessionsRoot, compression: 'none' } },
        { id: 'pi-ai', config: { providers: { fixture: { apiKeyEnv: 'PACKED_COMPAT_FIXTURE_KEY', api: 'openai-completions',
          baseURL, models: [{ id: MODEL }] } } } },
      ] }))

      const options = { profile: 'native-sdk' as const, dshBin: installedBin, dshHome: home, patches: [patch],
        cwd: workspace, provider: 'fixture' as const, model: MODEL, env: childEnv, requestTimeoutMs: 20_000 }
      const bridgeHarness = new DeepSeekHarness(options)
      let first: RunResult
      try { first = await bridgeHarness.session(SESSION_ID).run(FIRST_TASK) }
      finally { await bridgeHarness.close() }

      expect(JSON.stringify(requests[0]?.tools)).toContain('"name":"write"')
      expect(first.sessionId).toBe(SESSION_ID)
      expect(first.finalResponse).toBe(FIRST_REPLY)
      expect(first.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      const writeResults = toolResults(first.events, TOOL_CALL_ID)
      expect(writeResults).toHaveLength(1)
      expect(writeResults[0]).toMatchObject({ toolCallId: TOOL_CALL_ID, isError: false })
      await expect(readFile(join(workspace, FILE_PATH), 'utf8')).resolves.toBe(MARKER)

      await writeFile(profileConfig, nativeProfile)
      const nativeHarness = new DeepSeekHarness(options)
      let second: RunResult
      try { second = await nativeHarness.session(SESSION_ID).run(SECOND_TASK) }
      finally { await nativeHarness.close() }

      expect(JSON.stringify(requests[2]?.tools)).toContain('"name":"read"')
      expect(second.sessionId).toBe(SESSION_ID)
      expect(second.finalResponse).toBe(SECOND_REPLY)
      expect(second.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      const readResults = toolResults(second.events, READ_CALL_ID)
      expect(readResults).toHaveLength(1)
      expect(readResults[0]).toMatchObject({ toolCallId: READ_CALL_ID, isError: false })
      expect(JSON.stringify(readResults[0]?.content)).toContain(MARKER)
      expect(JSON.stringify(requests[2]?.messages)).toContain(TOOL_CALL_ID)
      expect(JSON.stringify(requests[2]?.messages)).toContain(MARKER)
      expect(requests).toHaveLength(4)
    } finally {
      try { if (server !== undefined) await closeServer(server) }
      finally { await rm(root, { recursive: true, force: true }) }
    }
  },
)
