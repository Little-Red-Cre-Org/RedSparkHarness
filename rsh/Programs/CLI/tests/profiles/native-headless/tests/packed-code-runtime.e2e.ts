/** Packed-consumer coverage for Native Headless run_code and its process-sandbox Provider. */
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { isAbsolute, join, relative, sep } from 'node:path'
import { execa } from 'execa'
import { expect, it } from 'vitest'

const PACKED_BIN = process.env.DSH_PACKED_DSH_BIN
const CONSUMER_ROOT = process.env.DSH_PACKED_CONSUMER_ROOT
const TASK = 'PACKED_CODE_RUNTIME_TASK_8a42d1'
const SUCCESS_ID = 'packed-code-runtime-success'
const DENIED_ID = 'packed-code-runtime-denied'
const SUCCESS_MARKER = 'PACKED_CODE_RUNTIME_VALUE_8a42d1'
const FINAL_RESULT = 'PACKED_CODE_RUNTIME_FINAL_8a42d1'
const MODEL = 'packed-code-runtime-fixture'

type JsonObject = Record<string, unknown>
type PersistedSession = { readonly header: JsonObject; readonly events: readonly JsonObject[] }

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function writeSse(response: ServerResponse, value: unknown): void {
  response.write(`data: ${JSON.stringify(value)}\n\n`)
}

function respondWithText(response: ServerResponse, text: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  writeSse(response, { choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
  response.end('data: [DONE]\n\n')
}

function respondWithCodeCall(response: ServerResponse, id: string, program: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  writeSse(response, { choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: 'function',
    function: { name: 'run_code', arguments: JSON.stringify({ program }) } }] }, finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
  response.end('data: [DONE]\n\n')
}

async function readSessions(root: string): Promise<PersistedSession[]> {
  const sessions: PersistedSession[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      const [header, ...events] = (await readFile(path, 'utf8')).split(/\r?\n/u).filter(Boolean)
        .map(line => JSON.parse(line) as unknown)
      if (!isRecord(header) || header.type !== 'session' || events.some(event => !isRecord(event))) {
        throw new Error(`packed-code-runtime: invalid Session JSONL in ${path}`)
      }
      sessions.push({ header, events: events as JsonObject[] })
    }
  }
  await visit(root)
  return sessions
}

function resultCallId(event: JsonObject): string | undefined {
  const data = isRecord(event.data) ? event.data : undefined
  const message = data !== undefined && isRecord(data.message) ? data.message : undefined
  const source = message !== undefined && isRecord(message.source) ? message.source : undefined
  return typeof source?.callId === 'string' ? source.callId : undefined
}

function persistedToolText(event: JsonObject): string | undefined {
  const data = isRecord(event.data) ? event.data : undefined
  const message = data !== undefined && isRecord(data.message) ? data.message : undefined
  const content: unknown[] | undefined = message !== undefined && Array.isArray(message.content) ? message.content : undefined
  const result = content?.find(value => isRecord(value) && value.type === 'tool-result')
  const resultContent: unknown[] | undefined = isRecord(result) && Array.isArray(result.content) ? result.content : undefined
  const text = resultContent?.find(value => isRecord(value) && value.type === 'text')
  return isRecord(text) && typeof text.text === 'string' ? text.text : undefined
}

function modelToolMessage(requests: readonly JsonObject[], id: string): JsonObject | undefined {
  for (const request of requests) {
    if (!Array.isArray(request.messages)) continue
    const messages: unknown[] = request.messages
    const message = messages.find(value => isRecord(value) && value.role === 'tool' && value.tool_call_id === id)
    if (isRecord(message)) return message
  }
  return undefined
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
  'runs Native Headless code through the packed process-sandbox Provider and cold-reads exact tool results',
  async () => {
    const consumerRoot = CONSUMER_ROOT
    const packedBin = PACKED_BIN
    if (consumerRoot === undefined || packedBin === undefined) throw new Error('packed consumer variables are missing')
    const installedRoot = await realpath(consumerRoot)
    const installedBin = await realpath(packedBin)
    const binRelative = relative(installedRoot, installedBin)
    expect(binRelative.startsWith(`..${sep}`) || isAbsolute(binRelative)).toBe(false)
    expect(binRelative.split(sep)).toEqual(['node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'])

    const home = await mkdtemp(join(installedRoot, '.dsh-p4-code-runtime-'))
    let server: ReturnType<typeof createServer> | undefined
    let processSettled = false
    let stopChildProcess: (() => Promise<void>) | undefined
    try {
      const workspace = join(home, 'workspace')
      const sessionsRoot = join(home, 'sessions')
      const outsideTarget = join(home, 'outside-workspace.txt')
      const patch = join(home, 'code-runtime.patch.json')
      await Promise.all([mkdir(workspace), mkdir(sessionsRoot)])

      const childEnv: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(home, 'agents'),
        DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'packed-local-fixture-key' }
      delete childEnv.NODE_OPTIONS
      delete childEnv.NODE_PATH
      delete childEnv.DEEPSEEK_BASE_URL

      const profileDump = await execa(process.execPath, [installedBin, '--profile', 'native-headless', '--dump-config'], {
        cwd: installedRoot, env: childEnv, extendEnv: false, reject: false, timeout: 30_000,
      })
      expect(profileDump.timedOut, profileDump.stderr).toBe(false)
      expect(profileDump.exitCode, profileDump.stderr).toBe(0)
      const dumpedProfile: unknown = JSON.parse(profileDump.stdout)
      if (!isRecord(dumpedProfile) || !Array.isArray(dumpedProfile.installations)) {
        throw new Error('packed-code-runtime: packed native-headless profile omitted installations')
      }
      const installations = dumpedProfile.installations.filter(isRecord)
      expect(installations.find(row => row.id === 'sandbox-policy')?.plugin).toBe('@deepseek-ai/dsh-native-sandbox-policy')
      expect(installations.find(row => row.id === 'sandbox')?.plugin).toBe('@deepseek-ai/dsh-sandbox-local')
      expect(installations.find(row => row.id === 'code-runtime')?.plugin).toBe('@deepseek-ai/dsh-code-runtime-process-sandbox')

      const requests: JsonObject[] = []
      const unexpectedRequests: string[] = []
      let requestCount = 0
      const modelServer = createServer((request: IncomingMessage, response: ServerResponse) => {
        let body = ''
        request.setEncoding('utf8')
        request.on('data', (chunk: string) => { body += chunk })
        request.on('end', () => {
          if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
            unexpectedRequests.push(`${request.method ?? '<no method>'} ${request.url ?? '<no path>'}`)
            response.writeHead(404).end()
            return
          }
          let parsed: unknown
          try { parsed = JSON.parse(body) as unknown }
          catch {
            unexpectedRequests.push('model request body was not JSON')
            response.writeHead(400).end()
            return
          }
          if (!isRecord(parsed)) {
            unexpectedRequests.push('model request body was not an object')
            response.writeHead(400).end()
            return
          }
          requests.push(parsed)
          requestCount += 1
          if (requestCount === 1) {
            respondWithCodeCall(response, SUCCESS_ID, `return { marker: ${JSON.stringify(SUCCESS_MARKER)}, answer: 42 }`)
          } else if (requestCount === 2) {
            respondWithCodeCall(response, DENIED_ID,
              `const fs = await import('node:fs'); fs.writeFileSync(${JSON.stringify(outsideTarget)}, 'escaped'); return true`)
          } else if (requestCount === 3) {
            respondWithText(response, FINAL_RESULT)
          } else {
            unexpectedRequests.push(`unexpected model request ${String(requestCount)}`)
            response.writeHead(500).end()
          }
        })
      })
      server = modelServer
      await new Promise<void>((resolve, reject) => {
        modelServer.once('error', reject)
        modelServer.listen(0, '127.0.0.1', () => { modelServer.removeListener('error', reject); resolve() })
      })
      const address = modelServer.address()
      if (address === null || typeof address === 'string') throw new Error('packed-code-runtime: model fixture did not bind')
      const baseURL = `http://127.0.0.1:${address.port}/v1`
      await writeFile(patch, JSON.stringify({ formatVersion: 1, installations: [
        { id: 'app', config: { cwd: workspace, provider: 'deepseek', model: MODEL,
          systemPrompt: 'Run the requested code checks and report their results.', maxSteps: 4 } },
        { id: 'storage', config: { root: sessionsRoot, compression: 'none' } },
        { id: 'sandbox-policy', config: { mode: 'workspace-write', workspaceRoot: workspace } },
        { id: 'pi-ai', config: { providers: { deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY', api: 'openai-completions', baseURL,
          models: [{ id: MODEL }] } } } },
      ] }))

      const childProcess = execa(process.execPath, [installedBin, '--profile', 'native-headless', '--patch', patch, TASK], {
        cwd: installedRoot, env: childEnv, extendEnv: false, reject: false, timeout: 100_000,
      })
      stopChildProcess = async () => { childProcess.kill('SIGTERM'); await childProcess }
      void childProcess.then(() => { processSettled = true }, () => { processSettled = true })
      const exit = await childProcess
      processSettled = true
      const failureOutput = `dsh stdout:\n${exit.stdout}\ndsh stderr:\n${exit.stderr}`
      expect(exit.timedOut, failureOutput).toBe(false)
      expect(exit.signal, failureOutput).toBeUndefined()
      expect(exit.exitCode, failureOutput).toBe(0)
      expect(exit.stdout).toContain(FINAL_RESULT)
      expect(unexpectedRequests).toEqual([])
      expect(requestCount).toBe(3)
      expect(requests).toHaveLength(3)
      expect(JSON.stringify(requests[0]?.tools)).toContain('run_code')

      const successMessage = modelToolMessage(requests, SUCCESS_ID)
      expect(successMessage).toBeDefined()
      const modelSuccessText = successMessage?.content
      if (typeof modelSuccessText !== 'string') throw new Error('packed-code-runtime: model omitted success tool content')
      expect(modelSuccessText).toContain(SUCCESS_MARKER)
      expect(modelSuccessText).toContain('"answer":42')
      const deniedMessage = modelToolMessage(requests, DENIED_ID)
      expect(deniedMessage).toBeDefined()
      const modelDeniedText = deniedMessage?.content
      if (typeof modelDeniedText !== 'string') throw new Error('packed-code-runtime: model omitted denied tool content')

      // The process has exited before reading JSONL, so these assertions use only durable Session facts.
      const sessions = await readSessions(sessionsRoot)
      const parent = sessions.find(session => session.events.some(event => event.type === 'tool/result'
        && resultCallId(event) === SUCCESS_ID))
      expect(parent).toBeDefined()
      if (parent === undefined) throw new Error('packed-code-runtime: tool result Session did not persist')
      const successResult = parent.events.find(event => event.type === 'tool/result' && resultCallId(event) === SUCCESS_ID)
      const deniedResult = parent.events.find(event => event.type === 'tool/result' && resultCallId(event) === DENIED_ID)
      expect(successResult).toBeDefined()
      expect(persistedToolText(successResult!)).toBe(modelSuccessText)
      expect(persistedToolText(successResult!)).toContain(SUCCESS_MARKER)
      expect(deniedResult).toBeDefined()
      expect(deniedResult).toMatchObject({ data: {
        error: { name: 'NativeCodeRuntimeError', code: 'CODE_RUNTIME_EXCEPTION' },
        message: { content: [{ type: 'tool-result', isError: true }] },
      } })
      // The denial must come from the write itself, not from an earlier failure such as the fs import.
      expect(persistedToolText(deniedResult!)).toBe(modelDeniedText)
      expect(persistedToolText(deniedResult!)).toMatch(/(EACCES|EPERM|EROFS)[^]*outside-workspace\.txt/)
      expect(existsSync(outsideTarget)).toBe(false)
    } finally {
      if (stopChildProcess !== undefined && !processSettled) await stopChildProcess()
      try {
        if (server !== undefined) await closeServer(server)
      } finally {
        await rm(home, { recursive: true, force: true })
      }
    }
  },
  120_000,
)
