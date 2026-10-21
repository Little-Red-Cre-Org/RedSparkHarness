/** Packed-consumer smoke for the native Workflow Consumer, worker, and spawned Session path. */
import { copyFile, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { isAbsolute, join, relative, sep } from 'node:path'
import { execa } from 'execa'
import { expect, it } from 'vitest'

const PACKED_BIN = process.env.DSH_PACKED_DSH_BIN
const CONSUMER_ROOT = process.env.DSH_PACKED_CONSUMER_ROOT
const PARENT_TASK = 'PACKED_WORKFLOW_PARENT_TASK_5b0c7a'
const CHILD_TASK = 'PACKED_WORKFLOW_CHILD_TASK_5b0c7a'
const CHILD_RESULT = 'PACKED_WORKFLOW_CHILD_RESULT_5b0c7a'
const FINAL_RESULT = 'PACKED_WORKFLOW_FINAL_RESULT_5b0c7a'
const MODEL = 'packed-workflow-fixture'

type JsonObject = Record<string, unknown>
type PersistedSession = { readonly path: string; readonly header: JsonObject; readonly events: readonly JsonObject[] }

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

function respondWithWorkflowCall(response: ServerResponse): void {
  const args = {
    meta: { name: 'packed-workflow-smoke', description: 'Verify one real spawned child and its persisted result.' },
    script: `const childText = await agent(${JSON.stringify(CHILD_TASK)}); return { childText }`,
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  writeSse(response, { choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }] })
  writeSse(response, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'packed-workflow-call', type: 'function',
    function: { name: 'workflow', arguments: JSON.stringify(args) } }] }, finish_reason: null }] })
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
      const rows = (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean)
        .map(line => JSON.parse(line) as unknown)
      const [header, ...events] = rows
      if (!isRecord(header) || header.type !== 'session') throw new Error(`packed-workflow: invalid Session header in ${path}`)
      if (events.some(event => !isRecord(event))) throw new Error(`packed-workflow: invalid Session event in ${path}`)
      sessions.push({ path, header, events: events as JsonObject[] })
    }
  }
  await visit(root)
  return sessions
}

function hasEvent(session: PersistedSession, type: string): JsonObject[] {
  return session.events.filter(event => event.type === type)
}

function eventData(event: JsonObject): JsonObject {
  if (!isRecord(event.data)) throw new Error(`packed-workflow: ${String(event.type)} has no event data`)
  return event.data
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
  'runs native Workflow through an independently packed dsh consumer and cold-reads its Sessions',
  async () => {
    const consumerRoot = CONSUMER_ROOT
    const packedBin = PACKED_BIN
    if (consumerRoot === undefined || packedBin === undefined) throw new Error('packed consumer variables are missing')
    const installedRoot = await realpath(consumerRoot)
    const installedBin = await realpath(packedBin)
    const binRelative = relative(installedRoot, installedBin)
    expect(binRelative.startsWith(`..${sep}`) || isAbsolute(binRelative)).toBe(false)
    expect(binRelative.split(sep)).toEqual(['node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'])

    const home = await mkdtemp(join(installedRoot, '.dsh-p4-workflow-'))
    let server: ReturnType<typeof createServer> | undefined
    let stopChildProcess: (() => Promise<void>) | undefined
    let processSettled = false
    try {
      const workspace = join(home, 'workspace')
      const sessionsRoot = join(home, 'sessions')
      const patch = join(home, 'workflow.patch.json')
      await Promise.all([mkdir(workspace), mkdir(sessionsRoot)])
      const requests: JsonObject[] = []
      const unexpectedRequests: string[] = []
      let parentRequests = 0
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
          const messages = JSON.stringify(parsed.messages) ?? ''
          if (messages.includes('You are a delegated subagent:') && messages.includes(CHILD_TASK)) {
            respondWithText(response, CHILD_RESULT)
          } else {
            parentRequests += 1
            if (parentRequests === 1 && messages.includes(PARENT_TASK)) respondWithWorkflowCall(response)
            else if (parentRequests === 2) respondWithText(response, FINAL_RESULT)
            else {
              unexpectedRequests.push(`unexpected model request ${String(parentRequests)}: ${messages.slice(-300)}`)
              response.writeHead(500).end()
            }
          }
        })
      })
      server = modelServer
      await new Promise<void>((resolve, reject) => {
        modelServer.once('error', reject)
        modelServer.listen(0, '127.0.0.1', () => { modelServer.removeListener('error', reject); resolve() })
      })
      const address = modelServer.address()
      if (address === null || typeof address === 'string') throw new Error('packed-workflow: model fixture did not bind')
      const baseURL = `http://127.0.0.1:${address.port}/v1`
      await writeFile(patch, JSON.stringify({ formatVersion: 1, installations: [
        { id: 'app', config: { cwd: workspace, provider: 'deepseek', model: MODEL,
          systemPrompt: 'Call the workflow tool for the requested review, then report its result.', maxSteps: 4 } },
        { id: 'storage', config: { root: sessionsRoot, compression: 'none' } },
        { id: 'sandbox-policy', config: { mode: 'workspace-write', workspaceRoot: workspace } },
        { id: 'pi-ai', config: { providers: { deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY', api: 'openai-completions', baseURL,
          models: [{ id: MODEL }] } } } },
      ] }))

      const childEnv: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(home, 'agents'),
        DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'packed-local-fixture-key' }
      delete childEnv.NODE_OPTIONS
      delete childEnv.NODE_PATH
      delete childEnv.DEEPSEEK_BASE_URL
      const childProcess = execa(process.execPath, [installedBin, '--profile', 'native-headless', '--patch', patch, PARENT_TASK], {
        cwd: installedRoot, env: childEnv, reject: false, timeout: 100_000,
      })
      stopChildProcess = async () => { childProcess.kill('SIGTERM'); await childProcess }
      void childProcess.then(() => { processSettled = true }, () => { processSettled = true })
      const maybeExit = await childProcess
      if (maybeExit === undefined) throw new Error('packed-workflow: dsh process produced no exit result')
      const exit = maybeExit
      processSettled = true
      const failureOutput = `dsh stdout:\n${exit.stdout}\ndsh stderr:\n${exit.stderr}`
      expect(exit.timedOut, failureOutput).toBe(false)
      expect(exit.signal, failureOutput).toBeUndefined()
      expect(exit.exitCode, failureOutput).toBe(0)
      expect(processSettled).toBe(true)
      expect(exit.stdout).toContain(FINAL_RESULT)
      expect(unexpectedRequests).toEqual([])
      expect(parentRequests).toBe(2)
      expect(requests).toHaveLength(3)
      expect(JSON.stringify(requests[2]?.messages)).toContain(CHILD_RESULT)

      // The dsh process has exited normally before these reads, so the assertions use only cold JSONL facts.
      const persisted = await readSessions(sessionsRoot)
      const parent = persisted.find(session => hasEvent(session, 'tool-workflow/run-start').length > 0)
      expect(parent).toBeDefined()
      if (parent === undefined) throw new Error('packed-workflow: parent Session did not persist workflow facts')
      const runStarts = hasEvent(parent, 'tool-workflow/run-start')
      const starts = hasEvent(parent, 'tool-workflow/agent-start')
      const ends = hasEvent(parent, 'tool-workflow/agent-end')
      const runEnds = hasEvent(parent, 'tool-workflow/run-end')
      expect(parent.header.parentSession).toBeUndefined()
      expect(runStarts).toHaveLength(1)
      const runId = eventData(runStarts[0]!).runId
      expect(eventData(runStarts[0]!)).toMatchObject({ runId, name: 'packed-workflow-smoke' })
      expect(starts).toHaveLength(1)
      const start = eventData(starts[0]!)
      expect(start).toMatchObject({ runId, label: CHILD_TASK, seq: 1 })
      expect(ends).toHaveLength(1)
      expect(eventData(ends[0]!)).toMatchObject({ runId, seq: start.seq, outcome: 'completed' })
      expect(runEnds).toHaveLength(1)
      expect(eventData(runEnds[0]!)).toMatchObject({ runId, stopReason: 'completed' })

      const toolResult = parent.events.find(event => event.type === 'tool/result'
        && (JSON.stringify(event) ?? '').includes(CHILD_RESULT))
      expect(toolResult).toBeDefined()
      expect(parent.events.indexOf(runStarts[0]!)).toBeLessThan(parent.events.indexOf(starts[0]!))
      expect(parent.events.indexOf(starts[0]!)).toBeLessThan(parent.events.indexOf(ends[0]!))
      expect(parent.events.indexOf(ends[0]!)).toBeLessThan(parent.events.indexOf(runEnds[0]!))
      if (toolResult !== undefined) expect(parent.events.indexOf(runEnds[0]!)).toBeLessThan(parent.events.indexOf(toolResult))
      const coldResult = JSON.stringify(toolResult) ?? ''
      expect(coldResult).toContain('childText')
      expect(coldResult).toContain(CHILD_RESULT)
      expect(coldResult).toContain('completed')
      expect(coldResult).toContain('isError')
      expect(coldResult).toContain('false')

      const childId = start.childId
      expect(typeof childId).toBe('string')
      const child = persisted.find(session => session.header.id === childId)
      expect(child).toBeDefined()
      if (child === undefined) throw new Error(`packed-workflow: child Session ${String(childId)} was not cold-readable`)
      expect(child.header).toMatchObject({ parentSession: parent.header.id, origin: 'subagent', delegationDepth: 1 })
      expect(hasEvent(child, 'subagent/descriptor').map(eventData)[0]).toMatchObject({ mode: 'one-shot', provider: 'spawn' })
      expect(hasEvent(child, 'turn/end').map(eventData).at(-1)).toMatchObject({ reason: { kind: 'completed' } })
      const coldChild = JSON.stringify(child.events) ?? ''
      expect(coldChild).toContain(CHILD_TASK)
      expect(coldChild).toContain(CHILD_RESULT)

      const evidenceDirectory = process.env.DSH_P4_EVIDENCE_DIR
      if (evidenceDirectory !== undefined) {
        await mkdir(evidenceDirectory, { recursive: true })
        const parentFile = 'parent.jsonl'
        const childFile = 'child.jsonl'
        await Promise.all([
          copyFile(parent.path, join(evidenceDirectory, parentFile)),
          copyFile(child.path, join(evidenceDirectory, childFile)),
        ])
        await writeFile(join(evidenceDirectory, 'manifest.json'), `${JSON.stringify({
          packedBinRealpath: installedBin,
          process: { exitCode: exit.exitCode, signal: exit.signal ?? null, timedOut: exit.timedOut },
          requestCount: requests.length,
          sessions: [
            { role: 'parent', file: parentFile, id: parent.header.id },
            { role: 'child', file: childFile, id: child.header.id, parentSession: child.header.parentSession },
          ],
        }, null, 2)}\n`)
      }
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
