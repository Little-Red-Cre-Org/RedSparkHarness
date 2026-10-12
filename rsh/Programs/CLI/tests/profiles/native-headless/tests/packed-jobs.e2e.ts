/** Packed-consumer coverage for the native Agent-owned Jobs and spawned Subagent path. */
import { copyFile, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { execa } from 'execa'
import { expect, it, vi } from 'vitest'

const PACKED_BIN = process.env.DSH_PACKED_DSH_BIN
const CONSUMER_ROOT = process.env.DSH_PACKED_CONSUMER_ROOT
const PARENT_TASK = 'PACKED_JOBS_PARENT_TASK_3c8f2d'
const ALPHA_TASK = 'PACKED_JOBS_ALPHA_TASK_3c8f2d'
const BRAVO_TASK = 'PACKED_JOBS_BRAVO_TASK_3c8f2d'
const ALPHA_OUTPUT = 'PACKED_JOBS_ALPHA_LIVE_OUTPUT_3c8f2d'
const BRAVO_OUTPUT = 'PACKED_JOBS_BRAVO_LIVE_OUTPUT_3c8f2d'
const BRAVO_RESULT = 'PACKED_JOBS_BRAVO_FINAL_RESULT_3c8f2d'
const PARENT_RESULT = 'PACKED_JOBS_PARENT_FINAL_RESULT_3c8f2d'
const MODEL = 'packed-jobs-fixture'
const MAX_ALPHA_LIVE_PROBES = 12

type JsonObject = Record<string, unknown>
type PersistedSession = { readonly path: string; readonly header: JsonObject; readonly events: readonly JsonObject[] }
type ToolCall = { readonly id: string; readonly name: string; readonly args: JsonObject }
type CliProcessExit = {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | undefined
  readonly signal: string | undefined
  readonly timedOut: boolean
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8')
  if (Array.isArray(value)) return value.map(outputText).join('\n')
  return value === undefined ? '' : JSON.stringify(value) ?? ''
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deferred<T = void>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function within<T>(promise: Promise<T>, label: string, timeoutMs = 30_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error(`packed-jobs: timed out waiting for ${label}`)) }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function writeSse(response: ServerResponse, value: unknown): void {
  response.write(`data: ${JSON.stringify(value)}\n\n`)
}

function writeTextStart(response: ServerResponse, text: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  writeSse(response, { choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })
}

function finishText(response: ServerResponse, text?: string): void {
  if (text !== undefined) writeSse(response, { choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
  response.end('data: [DONE]\n\n')
}

function respondWithText(response: ServerResponse, text: string): void {
  writeTextStart(response, text)
  finishText(response)
}

function respondWithToolCall(response: ServerResponse, call: ToolCall): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  writeSse(response, { choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: call.id, type: 'function',
    function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
  response.end('data: [DONE]\n\n')
}

function callId(id: string, name: string, args: JsonObject): ToolCall {
  return { id, name, args }
}

function hasModelToolOutput(request: JsonObject, id: string, text: string, status: string): boolean {
  if (!Array.isArray(request.messages)) return false
  return request.messages.some(message => isRecord(message) && message.role === 'tool'
    && message.tool_call_id === id && typeof message.content === 'string'
    && message.content.includes(text) && message.content.includes(status))
}

async function readSessions(root: string, options: { readonly allowIncompleteTail?: boolean } = {}): Promise<PersistedSession[]> {
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
      const content = await readFile(path, 'utf8')
      const hasTerminalNewline = /\r?\n$/u.test(content)
      const lines = content.split(/\r?\n/u)
      if (hasTerminalNewline) lines.pop()
      const rows: unknown[] = []
      for (let index = 0; index < lines.length; index++) {
        try { rows.push(JSON.parse(lines[index]!) as unknown) }
        catch (error: unknown) {
          // An observer may race an unterminated append; final cold reads and newline-terminated rows stay strict.
          const incompleteLiveTail = options.allowIncompleteTail === true && !hasTerminalNewline
            && index === lines.length - 1
          if (!incompleteLiveTail) throw error
        }
      }
      const [header, ...events] = rows
      if (!isRecord(header) || header.type !== 'session' || events.some(event => !isRecord(event))) {
        throw new Error(`packed-jobs: invalid Session JSONL in ${path}`)
      }
      sessions.push({ path, header, events: events as JsonObject[] })
    }
  }
  await visit(root)
  return sessions
}

function eventData(event: JsonObject): JsonObject {
  if (!isRecord(event.data)) throw new Error(`packed-jobs: ${String(event.type)} has no event data`)
  return event.data
}

function hasCallId(event: JsonObject, id: string): boolean {
  const data = isRecord(event.data) ? event.data : undefined
  if (data === undefined) return false
  if (event.type === 'tool/call') return data.callId === id
  if (event.type === 'tool/result') {
    const message = isRecord(data.message) ? data.message : undefined
    const source = message !== undefined && isRecord(message.source) ? message.source : undefined
    return source?.callId === id
  }
  if (event.type === 'user/message' && Array.isArray(data.content)) {
    return data.content.some(item => isRecord(item) && item.type === 'text' && item.text === id)
  }
  return false
}

function callEvent(session: PersistedSession, type: 'tool/call' | 'tool/result', id: string): JsonObject | undefined {
  return session.events.find(event => event.type === type && hasCallId(event, id))
}

function parentSession(sessions: readonly PersistedSession[]): PersistedSession | undefined {
  return sessions.find(session => session.header.parentSession === undefined
    && session.events.some(event => event.type === 'user/message' && hasCallId(event, PARENT_TASK)))
}

function toolMessageText(event: JsonObject): string {
  const data = eventData(event)
  return JSON.stringify(data.message ?? '')
}

function toolCallArguments(event: JsonObject): JsonObject {
  const value = eventData(event).arguments
  let parsed: unknown = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) as unknown }
    catch { throw new Error('packed-jobs: persisted tool call arguments were not JSON') }
  }
  if (!isRecord(parsed)) throw new Error('packed-jobs: persisted tool call arguments were not an object')
  return parsed
}

async function preserveEvidence(directory: string, sessionsRoot: string, sessions: readonly PersistedSession[],
  manifest: JsonObject): Promise<void> {
  const root = resolve(directory)
  for (const session of sessions) {
    const destination = join(root, 'sessions', relative(sessionsRoot, session.path))
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(session.path, destination)
  }
  await writeFile(join(root, 'manifest.json'), `${JSON.stringify({ ...manifest,
    sessions: sessions.map(session => ({ id: session.header.id, parentSession: session.header.parentSession,
      relativePath: join('sessions', relative(sessionsRoot, session.path)) })) }, null, 2)}\n`)
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
  'runs native background Subagent Jobs through a packed dsh consumer and cold-reads parent and child Sessions',
  async () => {
    const consumerRoot = CONSUMER_ROOT
    const packedBin = PACKED_BIN
    if (consumerRoot === undefined || packedBin === undefined) throw new Error('packed consumer variables must be supplied together')
    const installedRoot = await realpath(consumerRoot)
    const installedBin = await realpath(packedBin)
    const binRelative = relative(installedRoot, installedBin)
    expect(binRelative.startsWith(`..${sep}`) || isAbsolute(binRelative)).toBe(false)
    expect(binRelative.split(sep)).toEqual(['node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'])

    const home = await mkdtemp(join(installedRoot, '.dsh-p4-jobs-'))
    let server: ReturnType<typeof createServer> | undefined
    let invocation: Promise<CliProcessExit> | undefined
    let terminateInvocation: ((signal: NodeJS.Signals) => void) | undefined
    let processSettled = false
    let processExit: CliProcessExit | undefined
    const releaseBravo = deferred()
    const releaseFinalParentRequest = deferred()
    const alphaReady = deferred()
    const bravoReady = deferred()
    const alphaStreamClosed = deferred()
    const finalParentRequest = deferred<JsonObject>()
    try {
      const workspace = join(home, 'workspace')
      const sessionsRoot = join(home, 'sessions')
      const patch = join(home, 'jobs.patch.json')
      await Promise.all([mkdir(workspace), mkdir(sessionsRoot)])

      const childEnv: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(home, 'agents'),
        DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'packed-local-fixture-key' }
      delete childEnv.NODE_OPTIONS
      delete childEnv.NODE_PATH
      delete childEnv.DEEPSEEK_BASE_URL
      // Start from the profile composition returned by the packed CLI, then enable its optional model-facing
      // Subagent Consumer. The consumer process still resolves all selected plugins from the independent install.
      const profileDump = await execa(process.execPath, [installedBin, '--profile', 'native-headless', '--dump-config'], {
        cwd: installedRoot, env: childEnv, reject: false, timeout: 30_000,
      })
      expect(profileDump.timedOut, profileDump.stderr).toBe(false)
      expect(profileDump.exitCode, profileDump.stderr).toBe(0)
      let dumpedProfile: unknown
      try { dumpedProfile = JSON.parse(profileDump.stdout) as unknown }
      catch { throw new Error(`packed-jobs: packed profile dump was not JSON: ${profileDump.stdout.slice(-1_000)}`) }
      if (!isRecord(dumpedProfile) || !Array.isArray(dumpedProfile.installations)) {
        throw new Error('packed-jobs: packed native-headless profile dump omitted installations')
      }
      const installations = dumpedProfile.installations
      expect(installations.some(installation => isRecord(installation) && installation.id === 'subagent-tool')).toBe(false)
      installations.push({ id: 'subagent-tool', plugin: '@deepseek-ai/dsh-tool-subagent', scope: 'root',
        config: { toolName: 'subagent', maxDepth: 2 } })
      await writeFile(join(home, 'profiles', 'native-headless', 'rsh.profile.json'), JSON.stringify(dumpedProfile))

      const requests: JsonObject[] = []
      const unexpectedRequests: string[] = []
      let parentRequestCount = 0
      let alphaLiveProbeCount = 0
      let alphaLiveListRequestAt = 0
      const fixtureServer = createServer((request: IncomingMessage, response: ServerResponse) => {
        let body = ''
        request.setEncoding('utf8')
        request.on('data', (chunk: string) => { body += chunk })
        request.on('end', () => {
          void (async () => {
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
            const messages = JSON.stringify(parsed.messages) ?? ''
            if (messages.includes('You are a delegated subagent:') && messages.includes(ALPHA_TASK)) {
              response.on('close', () => { if (!response.writableEnded) alphaStreamClosed.resolve(undefined) })
              writeTextStart(response, ALPHA_OUTPUT)
              alphaReady.resolve(undefined)
              return // Alpha remains a live model stream until the parent kills its Job.
            }
            if (messages.includes('You are a delegated subagent:') && messages.includes(BRAVO_TASK)) {
              writeTextStart(response, BRAVO_OUTPUT)
              bravoReady.resolve(undefined)
              await releaseBravo.promise
              if (!response.destroyed && !response.writableEnded) finishText(response, `\n${BRAVO_RESULT}`)
              return
            }

            parentRequestCount += 1
            switch (parentRequestCount) {
              case 1:
                if (!messages.includes(PARENT_TASK)) throw new Error('first parent model request omitted the unique task')
                respondWithToolCall(response, callId('packed-jobs-start-alpha', 'subagent', {
                  description: 'alpha child held until cancellation', prompt: ALPHA_TASK, run_in_background: true,
                }))
                return
              case 2:
                respondWithToolCall(response, callId('packed-jobs-start-bravo', 'subagent', {
                  description: 'bravo child held until job_output', prompt: BRAVO_TASK, run_in_background: true,
                }))
                return
              case 3:
                await within(Promise.all([alphaReady.promise, bravoReady.promise]), 'both live child model streams')
                alphaLiveProbeCount = 1
                respondWithToolCall(response, callId(`packed-jobs-alpha-live-probe-${alphaLiveProbeCount}`, 'job_output', {
                  job_id: 'subagent-1', wait: false,
                }))
                return
              default:
                break
            }

            if (alphaLiveProbeCount > 0 && alphaLiveListRequestAt === 0) {
              const probeId = `packed-jobs-alpha-live-probe-${alphaLiveProbeCount}`
              const activeParent = parentSession(await readSessions(sessionsRoot, { allowIncompleteTail: true }))
              const persistedProbe = activeParent === undefined
                ? undefined : callEvent(activeParent, 'tool/result', probeId)
              const persistedOutput = persistedProbe !== undefined
                && toolMessageText(persistedProbe).includes(ALPHA_OUTPUT)
                && toolMessageText(persistedProbe).includes('[status: running]')
              const modelReceivedOutput = hasModelToolOutput(parsed, probeId, ALPHA_OUTPUT, '[status: running]')
              if (persistedOutput && modelReceivedOutput) {
                alphaLiveListRequestAt = parentRequestCount
                respondWithToolCall(response, callId('packed-jobs-list-before-kill', 'job_list', {}))
                return
              }
              if (alphaLiveProbeCount >= MAX_ALPHA_LIVE_PROBES) {
                throw new Error(`alpha live output was not persisted and returned after ${String(alphaLiveProbeCount)} probes`)
              }
              alphaLiveProbeCount += 1
              respondWithToolCall(response, callId(`packed-jobs-alpha-live-probe-${alphaLiveProbeCount}`, 'job_output', {
                job_id: 'subagent-1', wait: false,
              }))
              return
            }

            switch (parentRequestCount - alphaLiveListRequestAt) {
              case 1:
                respondWithToolCall(response, callId('packed-jobs-kill-alpha', 'job_kill', { job_id: 'subagent-1', reason: 'fixture cancels alpha only' }))
                return
              case 2:
                respondWithToolCall(response, callId('packed-jobs-output-alpha', 'job_output', { job_id: 'subagent-1', wait: true, timeout_ms: 30_000 }))
                return
              case 3:
                respondWithToolCall(response, callId('packed-jobs-list-after-kill', 'job_list', {}))
                return
              case 4:
                finalParentRequest.resolve(parsed)
                await releaseFinalParentRequest.promise
                respondWithToolCall(response, callId('packed-jobs-output-bravo', 'job_output', { job_id: 'subagent-2', wait: true, timeout_ms: 30_000 }))
                return
              case 5:
                respondWithText(response, PARENT_RESULT)
                return
              default:
                throw new Error(`unexpected parent model request ${parentRequestCount}: ${messages.slice(-400)}`)
            }
          })().catch((error: unknown) => {
            unexpectedRequests.push(error instanceof Error ? error.message : String(error))
            if (!response.headersSent) response.writeHead(500)
            response.end()
          })
        })
      })
      server = fixtureServer
      await new Promise<void>((resolve, reject) => {
        fixtureServer.once('error', reject)
        fixtureServer.listen(0, '127.0.0.1', () => { fixtureServer.removeListener('error', reject); resolve() })
      })
      const address = fixtureServer.address()
      if (address === null || typeof address === 'string') throw new Error('packed-jobs: model fixture did not bind')
      const baseURL = `http://127.0.0.1:${address.port}/v1`
      await writeFile(patch, JSON.stringify({ formatVersion: 1, installations: [
        { id: 'app', config: { cwd: workspace, provider: 'deepseek', model: MODEL,
          systemPrompt: 'Start the requested background subagents, then use the native Jobs tools exactly as directed.',
          maxSteps: MAX_ALPHA_LIVE_PROBES + 8, builtinTools: false } },
        { id: 'storage', config: { root: sessionsRoot, compression: 'none' } },
        { id: 'sandbox-policy', config: { mode: 'workspace-write', workspaceRoot: workspace } },
        { id: 'pi-ai', config: { providers: { deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY', api: 'openai-completions', baseURL,
          models: [{ id: MODEL }] } } } },
      ] }))

      const child = execa(process.execPath, [installedBin, '--profile', 'native-headless', '--patch', patch, PARENT_TASK], {
        cwd: installedRoot, env: childEnv, reject: false, timeout: 100_000,
      })
      terminateInvocation = (signal) => { child.kill(signal) }
      const processResult: Promise<CliProcessExit> = child.then(result => ({
        stdout: outputText(result.stdout), stderr: outputText(result.stderr),
        exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut,
      }), (error: unknown) => ({ stdout: '', stderr: error instanceof Error ? error.message : String(error),
        exitCode: undefined, signal: undefined, timedOut: false }))
      invocation = processResult
      void processResult.then((exit) => { processSettled = true; processExit = exit })

      const startup = Promise.race([
        Promise.all([alphaReady.promise, bravoReady.promise]).then(() => ({ kind: 'children-ready' as const })),
        processResult.then(exit => ({ kind: 'process-exited' as const, exit })),
      ])
      try {
        const ready = await within(startup, 'both live child model streams')
        if (ready.kind === 'process-exited') {
          processSettled = true
          processExit = ready.exit
          throw new Error('dsh exited before both child model streams became live')
        }
      } catch (error: unknown) {
        if (!processSettled && invocation !== undefined) {
          terminateInvocation?.('SIGTERM')
          processExit = await invocation
          processSettled = true
        } else if (processExit === undefined && invocation !== undefined) {
          processExit = await invocation
          processSettled = true
        }
        const requestSummary = requests.map(request => ({ model: request.model,
          tools: Array.isArray(request.tools)
            ? request.tools.map(tool => isRecord(tool) && isRecord(tool.function) ? tool.function.name : undefined) : [],
          messageTail: (JSON.stringify(request.messages) ?? '').slice(-700) }))
        const persistedSummary = (await readSessions(sessionsRoot)).map(session => ({ id: session.header.id,
          parentSession: session.header.parentSession,
          events: session.events.filter(event => ['tool/call', 'tool/result', 'turn/end', 'subagent/descriptor'].includes(String(event.type)))
            .map(event => JSON.stringify(event).slice(0, 1_200)) }))
        throw new Error(`packed-jobs: child startup failed; parentRequests=${parentRequestCount}; unexpected=${JSON.stringify(unexpectedRequests)}; requests=${JSON.stringify(requestSummary)}; sessions=${JSON.stringify(persistedSummary)}; stdout=${processExit?.stdout ?? ''}; stderr=${processExit?.stderr ?? ''}`,
          { cause: error })
      }
      await within(finalParentRequest.promise, 'the parent request after its post-kill job_list')

      // This request can only arrive after the preceding kill, wait-for-alpha, and job_list calls were persisted.
      // Hold its response while the test verifies the surviving sibling remains running in the shared registry.
      let observedParent: PersistedSession | undefined
      await vi.waitFor(async () => {
        const persisted = await readSessions(sessionsRoot, { allowIncompleteTail: true })
        observedParent = parentSession(persisted)
        expect(observedParent).toBeDefined()
        if (observedParent === undefined) return
        const alphaStarted = callEvent(observedParent, 'tool/result', 'packed-jobs-start-alpha')
        const bravoStarted = callEvent(observedParent, 'tool/result', 'packed-jobs-start-bravo')
        const alphaLiveOutput = callEvent(observedParent, 'tool/result', `packed-jobs-alpha-live-probe-${String(alphaLiveProbeCount)}`)
        const killed = callEvent(observedParent, 'tool/result', 'packed-jobs-kill-alpha')
        const alphaOutput = callEvent(observedParent, 'tool/result', 'packed-jobs-output-alpha')
        const listedAfterKill = callEvent(observedParent, 'tool/result', 'packed-jobs-list-after-kill')
        expect(alphaStarted).toBeDefined()
        expect(bravoStarted).toBeDefined()
        expect(alphaLiveOutput).toBeDefined()
        expect(killed).toBeDefined()
        expect(alphaOutput).toBeDefined()
        expect(listedAfterKill).toBeDefined()
        if (alphaStarted === undefined || bravoStarted === undefined || alphaLiveOutput === undefined || killed === undefined
          || alphaOutput === undefined || listedAfterKill === undefined) return
        expect(toolMessageText(alphaLiveOutput)).toContain(ALPHA_OUTPUT)
        expect(toolMessageText(alphaLiveOutput)).toContain('[status: running]')
        expect(toolMessageText(killed)).toContain('requested cancellation of job subagent-1')
        expect(toolMessageText(alphaOutput)).toContain(ALPHA_OUTPUT)
        expect(toolMessageText(alphaOutput)).toContain('[status: cancelled]')
        expect(toolMessageText(listedAfterKill)).toContain('subagent-1 [subagent] cancelled')
        expect(toolMessageText(listedAfterKill)).toContain('subagent-2 [subagent] running')
      }, { timeout: 30_000, interval: 25 })

      releaseFinalParentRequest.resolve(undefined)
      await vi.waitFor(async () => {
        const current = parentSession(await readSessions(sessionsRoot, { allowIncompleteTail: true }))
        expect(current).toBeDefined()
        if (current === undefined) return
        const outputCall = callEvent(current, 'tool/call', 'packed-jobs-output-bravo')
        expect(outputCall).toBeDefined()
        if (outputCall !== undefined) expect(toolCallArguments(outputCall)).toMatchObject({ job_id: 'subagent-2', wait: true })
        expect(callEvent(current, 'tool/result', 'packed-jobs-output-bravo')).toBeUndefined()
      }, { timeout: 30_000, interval: 25 })
      releaseBravo.resolve(undefined)

      const completedProcess = invocation
      if (completedProcess === undefined) throw new Error('packed-jobs: dsh process was not started')
      const exit = await completedProcess
      processSettled = true
      processExit = exit
      expect(exit.timedOut, exit.stderr).toBe(false)
      expect(exit.signal, exit.stderr).toBeUndefined()
      expect(exit.exitCode, exit.stderr).toBe(0)
      expect(exit.stdout).toContain(PARENT_RESULT)
      expect(unexpectedRequests).toEqual([])
      expect(alphaLiveProbeCount).toBeGreaterThanOrEqual(1)
      expect(alphaLiveProbeCount).toBeLessThanOrEqual(MAX_ALPHA_LIVE_PROBES)
      expect(parentRequestCount).toBe(8 + alphaLiveProbeCount)
      expect(requests).toHaveLength(parentRequestCount + 2)
      await within(alphaStreamClosed.promise, 'the cancelled alpha model request to close')

      // Read only after dsh has exited. Native job records are process-local, so durable results correlate each
      // job id to its child Session; the child's parentSession links it to this root Session. In NativeHeadless,
      // the Program constructs AgentId from the SessionId (native.ts:1812), making that durable owner lineage
      // an implementation-backed inference. Exact owner fencing is directly covered by native-jobs unit tests.
      const persisted = await readSessions(sessionsRoot)
      const parent = parentSession(persisted)
      expect(parent).toBeDefined()
      if (parent === undefined) throw new Error('packed-jobs: parent Session did not persist')
      expect(parent.header.parentSession).toBeUndefined()
      expect(JSON.stringify(parent.events)).toContain(PARENT_TASK)

      const alphaStart = callEvent(parent, 'tool/result', 'packed-jobs-start-alpha')
      const bravoStart = callEvent(parent, 'tool/result', 'packed-jobs-start-bravo')
      expect(alphaStart).toBeDefined()
      expect(bravoStart).toBeDefined()
      if (alphaStart === undefined || bravoStart === undefined) throw new Error('packed-jobs: start results did not persist')
      const alphaMeta = eventData(alphaStart).meta
      const bravoMeta = eventData(bravoStart).meta
      expect(alphaMeta).toMatchObject({ kind: 'subagent', provider: 'spawn', jobId: 'subagent-1' })
      expect(bravoMeta).toMatchObject({ kind: 'subagent', provider: 'spawn', jobId: 'subagent-2' })
      if (!isRecord(alphaMeta) || !isRecord(bravoMeta)) throw new Error('packed-jobs: subagent start metadata missing')
      expect(typeof alphaMeta.childSessionId).toBe('string')
      expect(typeof bravoMeta.childSessionId).toBe('string')
      const alphaChildId = alphaMeta.childSessionId as string
      const bravoChildId = bravoMeta.childSessionId as string
      expect(alphaChildId).not.toBe(bravoChildId)

      const initialList = callEvent(parent, 'tool/result', 'packed-jobs-list-before-kill')
      const alphaLiveOutput = callEvent(parent, 'tool/result', `packed-jobs-alpha-live-probe-${String(alphaLiveProbeCount)}`)
      const killed = callEvent(parent, 'tool/result', 'packed-jobs-kill-alpha')
      const alphaOutput = callEvent(parent, 'tool/result', 'packed-jobs-output-alpha')
      const listedAfterKill = callEvent(parent, 'tool/result', 'packed-jobs-list-after-kill')
      const bravoOutput = callEvent(parent, 'tool/result', 'packed-jobs-output-bravo')
      expect(initialList).toBeDefined()
      expect(alphaLiveOutput).toBeDefined()
      expect(killed).toBeDefined()
      expect(alphaOutput).toBeDefined()
      expect(listedAfterKill).toBeDefined()
      expect(bravoOutput).toBeDefined()
      if (initialList === undefined || alphaLiveOutput === undefined || killed === undefined || alphaOutput === undefined
        || listedAfterKill === undefined || bravoOutput === undefined) throw new Error('packed-jobs: a Jobs control result did not persist')
      expect(toolMessageText(alphaLiveOutput)).toContain(ALPHA_OUTPUT)
      expect(toolMessageText(alphaLiveOutput)).toContain('[status: running]')
      expect(toolMessageText(initialList)).toContain('subagent-1 [subagent] running')
      expect(toolMessageText(initialList)).toContain('subagent-2 [subagent] running')
      expect(toolMessageText(killed)).toContain('requested cancellation of job subagent-1')
      expect(toolMessageText(alphaOutput)).toContain(ALPHA_OUTPUT)
      expect(toolMessageText(alphaOutput)).toContain('[status: cancelled]')
      expect(toolMessageText(listedAfterKill)).toContain('subagent-1 [subagent] cancelled')
      expect(toolMessageText(listedAfterKill)).toContain('subagent-2 [subagent] running')
      expect(toolMessageText(bravoOutput)).toContain(BRAVO_OUTPUT)
      expect(toolMessageText(bravoOutput)).toContain(BRAVO_RESULT)
      expect(toolMessageText(bravoOutput)).toContain('[status: completed]')

      const alphaChild = persisted.find(session => session.header.id === alphaChildId)
      const bravoChild = persisted.find(session => session.header.id === bravoChildId)
      expect(alphaChild).toBeDefined()
      expect(bravoChild).toBeDefined()
      if (alphaChild === undefined || bravoChild === undefined) throw new Error('packed-jobs: a spawned child Session was not cold-readable')
      for (const child of [alphaChild, bravoChild]) {
        expect(child.header).toMatchObject({ parentSession: parent.header.id, origin: 'subagent', delegationDepth: 1 })
        const descriptor = child.events.find(event => event.type === 'subagent/descriptor')
        expect(descriptor).toBeDefined()
        expect(JSON.stringify(descriptor)).toContain('one-shot')
        expect(JSON.stringify(descriptor)).toContain('spawn')
      }
      expect(JSON.stringify(alphaChild.events)).toContain(ALPHA_TASK)
      expect(JSON.stringify(alphaChild.events)).toContain(ALPHA_OUTPUT)
      expect(hasTurnEnd(alphaChild)).toMatchObject({ reason: { kind: 'aborted' } })
      expect(JSON.stringify(bravoChild.events)).toContain(BRAVO_TASK)
      expect(JSON.stringify(bravoChild.events)).toContain(BRAVO_OUTPUT)
      expect(JSON.stringify(bravoChild.events)).toContain(BRAVO_RESULT)
      expect(hasTurnEnd(bravoChild)).toMatchObject({ reason: { kind: 'completed' } })
      expect(requests.filter(request => JSON.stringify(request.messages).includes('You are a delegated subagent:'))).toHaveLength(2)

      const evidenceDirectory = process.env.DSH_P4_EVIDENCE_DIR
      if (evidenceDirectory !== undefined) {
        await preserveEvidence(evidenceDirectory, sessionsRoot, [parent, alphaChild, bravoChild], {
          packedBin: installedBin,
          process: { exitCode: exit.exitCode, signal: exit.signal ?? null, timedOut: exit.timedOut },
          requestCount: requests.length,
          parentRequestCount,
          alphaLiveProbeCount,
          jobs: [
            { id: alphaMeta.jobId, childSessionId: alphaChildId, status: 'cancelled' },
            { id: bravoMeta.jobId, childSessionId: bravoChildId, status: 'completed' },
          ],
        })
      }
    } finally {
      releaseFinalParentRequest.resolve(undefined)
      releaseBravo.resolve(undefined)
      if (invocation !== undefined && !processSettled) {
        terminateInvocation?.('SIGTERM')
        await invocation
      }
      try {
        if (server !== undefined) await closeServer(server)
      } finally {
        await rm(home, { recursive: true, force: true })
      }
    }
  },
  120_000,
)

function hasTurnEnd(session: PersistedSession): JsonObject {
  const event = session.events.findLast(candidate => candidate.type === 'turn/end')
  if (event === undefined) throw new Error(`packed-jobs: Session ${String(session.header.id)} has no turn/end`)
  return eventData(event)
}
