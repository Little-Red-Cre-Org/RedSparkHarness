import { createServer, type ServerResponse } from 'node:http'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { DeepSeekHarness } from '../../../../SDK/packages/client/src/index.ts'

const bin = fileURLToPath(new URL('../../../src/bin.ts', import.meta.url))
const root = fileURLToPath(new URL('../../../../../../', import.meta.url))
const childTask = 'SDK_CHILD_MAX_STEPS_FIXTURE_3d0e8c'
const slowParentTask = 'SDK_CHILD_START_CANCEL_FIXTURE_3d0e8c'
const slowChildTask = 'SDK_CHILD_START_CANCEL_CHILD_FIXTURE_3d0e8c'
const readOnlyParentTask = 'SDK_CHILD_READ_ONLY_PARENT_FIXTURE_3d0e8c'
const readOnlyChildTask = 'SDK_CHILD_READ_ONLY_CHILD_FIXTURE_3d0e8c'
const directStepLimitTask = 'SDK_DIRECT_STEP_LIMIT_FIXTURE_3d0e8c'

function finishModelResponse(response: ServerResponse, content: string,
  tool?: { readonly id: string; readonly name: string; readonly arguments: string }): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.write('data: {"choices":[{"delta":{"role":"assistant","content":null}}]}\n\n')
  if (tool !== undefined) {
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{
      index: 0, id: tool.id, type: 'function', function: { name: tool.name, arguments: tool.arguments },
    }] } }] })}\n\n`)
  } else {
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
  }
  response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: tool === undefined ? 'stop' : 'tool_calls' }] })}\n\n`)
  response.end('data: [DONE]\n\n')
}

async function directories(path: string): Promise<string[]> {
  return (await readdir(path, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => join(path, entry.name))
}

async function childHomes(tempRoot: string): Promise<string[]> {
  const topLevel = await directories(tempRoot)
  const directHomes = topLevel.filter(path => basename(path).startsWith('dsh-sdk-child-'))
  const sandboxRoots = topLevel.filter(path => basename(path).startsWith('dsh-') && !basename(path).startsWith('dsh-sdk-child-'))
  const nestedHomes = (await Promise.all(sandboxRoots.map(async root =>
    (await directories(root)).filter(path => basename(path).startsWith('dsh-sdk-child-'))))).flat()
  return [...directHomes, ...nestedHomes]
}

function eventData(events: readonly unknown[], type: string): Record<string, unknown>[] {
  return events.flatMap(event => typeof event === 'object' && event !== null && 'type' in event
    && (event as { type?: unknown }).type === type && 'data' in event
    && typeof (event as { data?: unknown }).data === 'object' && (event as { data?: unknown }).data !== null
    ? [(event as { data: Record<string, unknown> }).data] : [])
}

function modelToolNames(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || !('tools' in value) || !Array.isArray(value.tools)) return []
  return value.tools.flatMap(tool => typeof tool === 'object' && tool !== null && 'function' in tool
    && typeof tool.function === 'object' && tool.function !== null && 'name' in tool.function
    && typeof tool.function.name === 'string' ? [tool.function.name] : [])
}

async function pathExists(path: string): Promise<boolean> {
  try { await access(path); return true }
  catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

async function persistedSessionEvents(storageRoot: string, sessionId: string): Promise<unknown[]> {
  for (const project of await directories(storageRoot)) {
    const session = join(project, sessionId)
    if (!await pathExists(session)) continue
    const log = (await readdir(session)).find(name => name.endsWith('.jsonl'))
    if (log === undefined) continue
    return (await readFile(join(session, log), 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as unknown)
  }
  throw new Error('native SDK child fixture did not persist the requested parent Session')
}

it('runs the selected Native SDK child and enforces the negotiated one-step ceiling', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-native-sdk-child-'))
  const runnerTempRoot = await mkdtemp(join(tmpdir(), 'dsh-native-sdk-parent-temp-'))
  const childRequests: unknown[] = []
  const rootRequests: unknown[] = []
  const parentEvents: unknown[] = []
  const slowChildRequest = Promise.withResolvers<undefined>()
  const readOnlyChildRequest = Promise.withResolvers<undefined>()
  const readOnlyResultRequest = Promise.withResolvers<undefined>()
  const readOnlyModelResponses: ServerResponse[] = []
  let childCalls = 0
  let directCalls = 0
  let rootCalls = 0
  let readOnlyDelegationStarted = false
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      const value = JSON.parse(body) as { messages?: unknown[] }
      const userText = (value.messages ?? []).flatMap((message) => {
        if (typeof message !== 'object' || message === null || !('role' in message) || !('content' in message)) return []
        const row = message as { role?: unknown; content?: unknown }
        return row.role === 'user' ? [JSON.stringify(row.content)] : []
      }).join('\n')
      const isDirect = userText.includes(directStepLimitTask)
      const isChild = !isDirect && [childTask, slowChildTask, readOnlyChildTask].some(task => userText.includes(task))
      const isReadOnlyParentStart = userText.includes(readOnlyParentTask) && !readOnlyDelegationStarted
      if (isReadOnlyParentStart) readOnlyDelegationStarted = true
      if (isDirect) directCalls++
      else if (isChild) {
        childRequests.push(value)
        childCalls++
      } else {
        rootRequests.push(value)
        rootCalls++
      }
      const requestBody = JSON.stringify(value.messages)
      if (isChild && requestBody.includes(readOnlyChildTask)) {
        if (requestBody.includes('parent-readable-content')) readOnlyResultRequest.resolve(undefined)
        else readOnlyChildRequest.resolve(undefined)
        readOnlyModelResponses.push(response)
        return
      }
      if (isChild && requestBody.includes(slowChildTask)) {
        slowChildRequest.resolve(undefined)
      }
      const tool = isDirect ? { name: 'write_file', arguments: JSON.stringify({ path: 'direct-write.txt', content: 'direct-sdk-child' }) }
        : isChild
          ? childCalls === 1 ? { name: 'write_file', arguments: JSON.stringify({ path: 'nested-write.txt', content: 'parent-granted-builtin' }) }
            : childCalls === 2 ? { name: 'write_file', arguments: JSON.stringify({ path: 'late-write.txt', content: 'late-approval-must-not-write' }) }
              : childCalls === 3 ? { name: 'read_file', arguments: JSON.stringify({ path: 'readable.txt' }) } : undefined
          : requestBody.includes(slowParentTask)
            ? { name: 'subagent', arguments: JSON.stringify({ description: 'cancel startup', prompt: slowChildTask }) }
            : isReadOnlyParentStart
              ? { name: 'subagent', arguments: JSON.stringify({ description: 'read-only child', prompt: readOnlyChildTask }) }
              : rootCalls === 1 ? { name: 'subagent', arguments: JSON.stringify({ description: 'bounded child', prompt: childTask }) } : undefined
      finishModelResponse(response, isChild ? 'child completed' : 'parent complete',
        tool === undefined ? undefined : { ...tool, id: `call-${rootCalls}-${childCalls}-${directCalls}` })
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock model server did not bind')
  const baseURL = `http://127.0.0.1:${address.port}/v1`
  const patch = join(home, 'child-model.patch.json')
  const readOnlyPatch = join(home, 'read-only-parent.patch.json')
  const readOnlyHome = join(home, 'read-only-parent-home')
  const readOnlyWorkspace = join(home, 'read-only-workspace')
  await mkdir(readOnlyWorkspace, { recursive: true })
  await writeFile(join(readOnlyWorkspace, 'readable.txt'), 'parent-readable-content')
  const providerPatch = { id: 'pi-ai', config: { providers: { 'deepseek-official': {
    apiKeyEnv: 'DEEPSEEK_API_KEY', api: 'openai-completions', baseURL, models: [{ id: 'sdk-child-fixture' }],
  } } } }
  await writeFile(patch, JSON.stringify({ formatVersion: 1, installations: [
    providerPatch,
    { id: 'subagent-tool', config: { toolName: 'subagent', maxDepth: 3, maxSteps: 1 } },
  ] }))
  await writeFile(readOnlyPatch, JSON.stringify({ formatVersion: 1, installations: [
    providerPatch,
    { id: 'subagent-tool', config: { toolName: 'subagent', maxDepth: 3, maxSteps: 2 } },
  ] }))
  const child = execa(process.execPath, ['--import', 'tsx/esm', bin, '--profile', 'native-sdk-dsh-child', '--patch', patch], {
    cwd: root,
    env: { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'fixture-key', DEEPSEEK_BASE_URL: baseURL,
      TMP: runnerTempRoot, TEMP: runnerTempRoot, TMPDIR: runnerTempRoot },
    reject: false,
    timeout: 40_000,
    killSignal: 'SIGKILL',
  })
  const frames: Record<string, unknown>[] = []
  let buffer = ''
  let stderr = ''
  let exited = false
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const frame = JSON.parse(line) as Record<string, unknown>
      frames.push(frame)
      if (frame.method === 'session.event' && typeof frame.params === 'object' && frame.params !== null) {
        parentEvents.push((frame.params as { event?: unknown }).event)
      }
    }
  })
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  void child.then(() => { exited = true }, () => { exited = true })
  const receive = async (predicate: (frame: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 30_000
    for (;;) {
      const index = frames.findIndex(predicate)
      if (index >= 0) return frames.splice(index, 1)[0]!
      if (exited) throw new Error(`native SDK child profile exited early: ${stderr}`)
      if (Date.now() > deadline) throw new Error(`native SDK child profile timed out: ${JSON.stringify({
        stderr, rootCalls, childCalls, directCalls, rootRequestCount: rootRequests.length,
        childRequestCount: childRequests.length,
        parentEventTypes: parentEvents.map(event => typeof event === 'object' && event !== null ? (event as { type?: unknown }).type : undefined),
        toolEvents: parentEvents.filter(event => typeof event === 'object' && event !== null
          && ['tool/call', 'tool/result', 'subagent/external-start', 'subagent/external-end'].includes(String((event as { type?: unknown }).type)))
          .map(event => ({ type: (event as { type?: unknown }).type, data: (event as { data?: unknown }).data })),
        pendingFrames: frames.map(frame => ({ id: frame.id, method: frame.method, error: frame.error })),
      })}`)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  try {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      cwd: home, provider: 'deepseek-official', model: 'sdk-child-fixture', maxSteps: 8,
    } })}\n`)
    expect(await receive(frame => frame.id === 1)).toMatchObject({
      result: { serverInfo: { name: 'deepseek-harness-sdk-runtime' }, maxSteps: 8 },
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: {
      sessionId: 'native-sdk-child-parent', contentBlocks: [{ type: 'text', text: 'start the bounded child' }],
    } })}\n`)
    expect(await receive(frame => frame.id === 2)).toMatchObject({ result: { messageId: expect.any(String) as unknown } })
    const approval = await receive(frame => frame.method === 'approval/request')
    const approvalParams = approval.params as Record<string, unknown>
    expect(approval.id).not.toBeUndefined()
    expect(approvalParams).toMatchObject({ toolName: 'write_file', operationId: expect.any(String),
      requestId: expect.any(String), sessionId: expect.any(String), callId: expect.any(String) })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: approval.id, result: {
      operationId: approvalParams.operationId, requestId: approvalParams.requestId, outcome: 'allowed-once',
    } }) + '\n')
    await receive(frame => frame.method === 'session.status'
      && (frame.params as { sessionId?: string; status?: string }).sessionId === 'native-sdk-child-parent'
      && (frame.params as { status?: string }).status === 'idle')
    expect({ childCalls, rootCalls }, JSON.stringify(parentEvents)).toEqual({ childCalls: 1, rootCalls: 2 })
    expect(childRequests).toHaveLength(1)
    expect(rootRequests).toHaveLength(2)
    expect(await import('node:fs/promises').then(fs => fs.readFile(join(home, 'nested-write.txt'), 'utf8')))
      .toBe('parent-granted-builtin')
    const firstStart = eventData(parentEvents, 'subagent/external-start')[0]
    const firstEnd = eventData(parentEvents, 'subagent/external-end')[0]
    expect(firstStart).toMatchObject({ provider: 'dsh-sdk', parentSessionId: 'native-sdk-child-parent' })
    expect(firstEnd).toMatchObject({ id: firstStart?.id, provider: 'dsh-sdk', stopReason: 'error' })
    expect(await childHomes(runnerTempRoot)).toEqual([])
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'session/prompt', params: {
      sessionId: 'native-sdk-child-cancel-start-parent', contentBlocks: [{ type: 'text', text: slowParentTask }],
    } })}\n`)
    expect(await receive(frame => frame.id === 3)).toMatchObject({ result: { messageId: expect.any(String) as unknown } })
    await slowChildRequest.promise
    const secondApproval = await receive(frame => frame.method === 'approval/request')
    const secondApprovalParams = secondApproval.params as Record<string, unknown>
    expect(secondApprovalParams).toMatchObject({ toolName: 'write_file', operationId: expect.any(String),
      requestId: expect.any(String), sessionId: expect.any(String), callId: expect.any(String) })
    expect(secondApprovalParams.requestId).not.toBe(approvalParams.requestId)
    const starts = eventData(parentEvents, 'subagent/external-start')
    expect(starts).toHaveLength(2)
    expect(starts[1]).toMatchObject({ provider: 'dsh-sdk', parentSessionId: 'native-sdk-child-cancel-start-parent' })
    expect(starts[1]?.id).not.toBe(firstStart?.id)
    const activeHomes = await childHomes(runnerTempRoot)
    expect(activeHomes).toHaveLength(1)
    const cancelledChildHome = activeHomes[0]!
    const sharedParentTempRoot = dirname(cancelledChildHome)
    if (process.platform === 'win32') expect(basename(sharedParentTempRoot)).toMatch(/^dsh-/)

    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'session/cancel', params: {
      sessionId: 'native-sdk-child-cancel-start-parent',
    } })}\n`)
    expect(await receive(frame => frame.id === 4)).toMatchObject({ result: { cancelled: true } })
    expect(await receive(frame => frame.method === 'approval/cancel'
      && (frame.params as { requestId?: unknown }).requestId === secondApprovalParams.requestId))
      .toMatchObject({ params: { operationId: secondApprovalParams.operationId, requestId: secondApprovalParams.requestId } })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: secondApproval.id, result: {
      operationId: secondApprovalParams.operationId, requestId: secondApprovalParams.requestId, outcome: 'allowed-once',
    } }) + '\n')
    await receive(frame => frame.method === 'session.status'
      && (frame.params as { sessionId?: string; status?: string }).sessionId === 'native-sdk-child-cancel-start-parent'
      && (frame.params as { status?: string }).status === 'idle')
    const ends = eventData(parentEvents, 'subagent/external-end')
    expect(ends).toHaveLength(2)
    expect(ends[1]).toMatchObject({ id: starts[1]?.id, provider: 'dsh-sdk', stopReason: 'aborted' })
    expect(new Set(starts.map(event => event.id)).size).toBe(2)
    expect(ends.map(event => event.id)).toEqual(starts.map(event => event.id))
    expect(await pathExists(cancelledChildHome)).toBe(false)
    if (process.platform === 'win32') expect(await pathExists(sharedParentTempRoot)).toBe(true)
    expect(await readdir(home)).not.toContain('late-write.txt')
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'shutdown' })}\n`)
    expect(await receive(frame => frame.id === 5)).toMatchObject({ result: {} })
    expect((await child).exitCode, stderr).toBe(0)
    if (process.platform === 'win32') expect(await pathExists(sharedParentTempRoot)).toBe(false)
    const firstDurable = await persistedSessionEvents(join(home, 'sessions'), 'native-sdk-child-parent')
    const secondDurable = await persistedSessionEvents(join(home, 'sessions'), 'native-sdk-child-cancel-start-parent')
    const firstAuditAsked = eventData(firstDurable, 'native-approval/asked').find(event => event.id === approvalParams.requestId)
    const firstAuditDecision = eventData(firstDurable, 'native-approval/decided').find(event => event.id === approvalParams.requestId)
    expect(firstAuditAsked).toMatchObject({
      toolName: 'write_file', callId: approvalParams.callId, reason: approvalParams.reason,
    })
    expect(firstAuditAsked?.reason).toContain(`External child ${firstStart?.id} request `)
    expect(firstAuditDecision).toMatchObject({ id: approvalParams.requestId, outcome: 'allowed-once' })
    const secondAuditAsked = eventData(secondDurable, 'native-approval/asked').find(event => event.id === secondApprovalParams.requestId)
    expect(secondAuditAsked).toMatchObject({
      toolName: 'write_file', callId: secondApprovalParams.callId, reason: secondApprovalParams.reason,
    })
    expect(secondAuditAsked?.reason).toContain(`External child ${starts[1]?.id} request `)
    const secondAuditDecision = eventData(secondDurable, 'native-approval/decided')
      .find(event => event.id === secondApprovalParams.requestId)
    expect(secondAuditDecision).toMatchObject({ id: secondApprovalParams.requestId, policy: 'ask', outcome: 'cancelled' })
    expect(secondAuditDecision?.outcome).not.toBe('allowed-once')
    const durableExternalStarts = [...eventData(firstDurable, 'subagent/external-start'),
      ...eventData(secondDurable, 'subagent/external-start')]
    const durableExternalEnds = [...eventData(firstDurable, 'subagent/external-end'),
      ...eventData(secondDurable, 'subagent/external-end')]
    expect(durableExternalStarts.map(event => event.id)).toEqual([firstStart?.id, starts[1]?.id])
    expect(durableExternalEnds.map(event => event.id)).toEqual(durableExternalStarts.map(event => event.id))
    expect(durableExternalEnds.map(event => event.stopReason)).toEqual(['error', 'aborted'])

    const readOnlyChild = execa(process.execPath, ['--import', 'tsx/esm', bin, '--profile', 'native-sdk-dsh-child', '--patch', readOnlyPatch], {
      cwd: root,
      env: { DSH_HOME: readOnlyHome, DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'fixture-key', DEEPSEEK_BASE_URL: baseURL,
        TMP: runnerTempRoot, TEMP: runnerTempRoot, TMPDIR: runnerTempRoot },
      reject: false,
      timeout: 40_000,
      killSignal: 'SIGKILL',
    })
    const readOnlyFrames: Record<string, unknown>[] = []
    const readOnlyEvents: unknown[] = []
    let readOnlyBuffer = ''
    let readOnlyStderr = ''
    let readOnlyExited = false
    readOnlyChild.stdout.on('data', (chunk: Buffer) => {
      readOnlyBuffer += chunk.toString('utf8')
      const lines = readOnlyBuffer.split('\n')
      readOnlyBuffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const frame = JSON.parse(line) as Record<string, unknown>
        readOnlyFrames.push(frame)
        if (frame.method === 'session.event' && typeof frame.params === 'object' && frame.params !== null) {
          readOnlyEvents.push((frame.params as { event?: unknown }).event)
        }
      }
    })
    readOnlyChild.stderr.on('data', (chunk: Buffer) => { readOnlyStderr += chunk.toString('utf8') })
    void readOnlyChild.then(() => { readOnlyExited = true }, () => { readOnlyExited = true })
    const receiveReadOnly = async (predicate: (frame: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> => {
      const deadline = Date.now() + 30_000
      for (;;) {
        const index = readOnlyFrames.findIndex(predicate)
        if (index >= 0) return readOnlyFrames.splice(index, 1)[0]!
        if (readOnlyExited) throw new Error(`read-only Native SDK child profile exited early: ${readOnlyStderr}`)
        if (Date.now() > deadline) throw new Error(`read-only Native SDK child profile timed out: ${readOnlyStderr}`)
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
    try {
      readOnlyChild.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        cwd: readOnlyWorkspace, provider: 'deepseek-official', model: 'sdk-child-fixture', maxSteps: 8,
        allowedTools: ['read_file', 'subagent'],
      } })}\n`)
      expect(await receiveReadOnly(frame => frame.id === 1)).toMatchObject({ result: { serverInfo: { name: 'deepseek-harness-sdk-runtime' } } })
      readOnlyChild.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: {
        sessionId: 'native-sdk-child-read-only-parent', contentBlocks: [{ type: 'text', text: readOnlyParentTask }],
      } })}\n`)
      expect(await receiveReadOnly(frame => frame.id === 2)).toMatchObject({ result: { messageId: expect.any(String) as unknown } })
      await readOnlyChildRequest.promise
      const noWriterHome = (await childHomes(runnerTempRoot))[0]
      expect(noWriterHome).toBeDefined()
      expect(modelToolNames(childRequests[2])).toContain('read_file')
      expect(modelToolNames(childRequests[2])).not.toContain('write_file')
      const readCall = readOnlyModelResponses.shift()
      if (readCall === undefined) throw new Error('read-only child did not hold its file-read model request')
      finishModelResponse(readCall, '', { id: 'read-parent-file', name: 'read_file', arguments: JSON.stringify({ path: 'readable.txt' }) })
      await readOnlyResultRequest.promise
      expect(JSON.stringify((childRequests[3] as { messages?: unknown }).messages)).toContain('parent-readable-content')
      expect(modelToolNames(childRequests[3])).toContain('read_file')
      expect(modelToolNames(childRequests[3])).not.toContain('write_file')
      const readResult = readOnlyModelResponses.shift()
      if (readResult === undefined) throw new Error('read-only child did not request its final model response')
      finishModelResponse(readResult, 'parent file read completed')
      await receiveReadOnly(frame => frame.method === 'session.status'
        && (frame.params as { sessionId?: string; status?: string }).sessionId === 'native-sdk-child-read-only-parent'
        && (frame.params as { status?: string }).status === 'idle')
      expect(eventData(readOnlyEvents, 'subagent/external-start')).toHaveLength(1)
      const readOnlyStart = eventData(readOnlyEvents, 'subagent/external-start')[0]
      expect(eventData(readOnlyEvents, 'subagent/external-end')).toContainEqual(expect.objectContaining({
        id: readOnlyStart?.id, provider: 'dsh-sdk', stopReason: 'completed',
      }))
      expect(readOnlyFrames.some(frame => frame.method === 'approval/request')).toBe(false)
      expect(await pathExists(noWriterHome!)).toBe(false)
      readOnlyChild.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'shutdown' })}\n`)
      expect(await receiveReadOnly(frame => frame.id === 3)).toMatchObject({ result: {} })
      expect((await readOnlyChild).exitCode, readOnlyStderr).toBe(0)
      const readOnlyDurable = await persistedSessionEvents(join(readOnlyHome, 'sessions'), 'native-sdk-child-read-only-parent')
      const durableReadOnlyStart = eventData(readOnlyDurable, 'subagent/external-start')[0]
      expect(eventData(readOnlyDurable, 'subagent/external-end')).toContainEqual(expect.objectContaining({
        id: durableReadOnlyStart?.id, provider: 'dsh-sdk', stopReason: 'completed',
      }))
      expect(await childHomes(runnerTempRoot)).toEqual([])
    } finally {
      if (!readOnlyExited) readOnlyChild.kill('SIGKILL')
      await readOnlyChild
    }

    const directHome = join(home, 'direct-sdk-home')
    const direct = new DeepSeekHarness({
      profile: 'native-sdk', patches: [patch], dshHome: directHome, processCwd: root,
      env: { DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'fixture-key' },
      cwd: home, provider: 'deepseek-official', model: 'sdk-child-fixture', maxSteps: 1,
      allowedTools: ['write_file'], workspaceWriteRoot: home,
    })
    try {
      const run = await direct.run(directStepLimitTask)
      expect(run.events).toContainEqual(expect.objectContaining({
        type: 'turn/end',
        data: expect.objectContaining({ reason: expect.objectContaining({
          kind: 'error', error: expect.objectContaining({ code: 'STEP_LIMIT' }),
        }) }),
      }))
      expect(directCalls).toBe(1)
      expect(await import('node:fs/promises').then(fs => fs.readFile(join(home, 'direct-write.txt'), 'utf8')))
        .toBe('direct-sdk-child')
    } finally { await direct.close() }
  } finally {
    child.kill('SIGKILL')
    await child
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => { resolve() }))
    await rm(home, { recursive: true, force: true })
    await rm(runnerTempRoot, { recursive: true, force: true })
  }
}, 45_000)
