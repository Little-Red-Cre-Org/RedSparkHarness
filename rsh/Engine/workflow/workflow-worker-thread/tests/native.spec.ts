/** Native workflow composition over the Program's existing Agent and Session executor. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativeApplication, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentId, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as sessionExecutionPlugin } from '@deepseek-ai/dsh-native-session-execution/native'
import { plugin as modelExecutionPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import { plugin as promptPlugin } from '@deepseek-ai/dsh-native-prompt/native'
import { plugin as subagentsPlugin } from '@deepseek-ai/dsh-native-subagent/native'
import { plugin as workflowPlugin } from '@deepseek-ai/dsh-workflow/native'
import { plugin as workerPlugin } from '../src/native.ts'
import { plugin as workflowToolPlugin } from '../../tool-workflow/src/native.ts'
import { plugin as ralphToolPlugin } from '../../tool-ralph/src/native.ts'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as policyPlugin } from '@deepseek-ai/dsh-fs-observation-policy/native'
import { plugin as storagePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { plugin as appPlugin } from '../../../core/native-headless/src/native.ts'
import type { NativeWorkflowObserver, NativeWorkflowOperations, WorkflowRun } from '@deepseek-ai/dsh-workflow/native'
import type { NativeSubagentOperations } from '@deepseek-ai/dsh-native-subagent/native'

type AdapterScript = ConstructorParameters<typeof MockAdapter>[0]

function multiToolCallResponse(calls: readonly { readonly id: string; readonly name: string; readonly args: object }[]): StreamChunk[] {
  const chunks: StreamChunk[] = []
  calls.forEach((call, index) => {
    for (const chunk of toolCallResponse(call.id, call.name, call.args)) {
      if (chunk.type === 'usage' || chunk.type === 'finish') continue
      chunks.push('index' in chunk ? { ...chunk, index } : chunk)
    }
  })
  chunks.push({ type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }, { type: 'finish', reason: { kind: 'tool-calls' } })
  return chunks
}

class NativeWorkflowAdapter extends MockAdapter {
  private readonly responses: AdapterScript
  private readonly waitAt: ReadonlySet<number>

  constructor(responses: AdapterScript, waitAt: ReadonlySet<number> = new Set()) {
    super([])
    this.responses = responses
    this.waitAt = waitAt
  }

  override async * stream(options: Parameters<MockAdapter['stream']>[0]) {
    this.requests.push(options)
    const index = this.requests.length - 1
    if (this.waitAt.has(index)) {
      yield { type: 'block-start', index: 0, blockType: 'text' } as const
      await new Promise<void>((_resolve, reject) => {
        const signal = options.signal
        if (signal === undefined) throw new Error('workflow cancellation fixture requires a model signal')
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- preserve AbortSignal's exact cancellation reason.
        const abort = (): void => { reject(signal.reason) }
        if (signal.aborted) abort()
        else signal.addEventListener('abort', abort, { once: true })
      })
      return
    }
    const response = this.responses[index]
    if (response === undefined || typeof response === 'string' || !Array.isArray(response)) {
      throw new Error(`missing native workflow response at request ${index}`)
    }
    for (const chunk of response) {
      if (options.signal?.aborted) throw options.signal.reason
      yield chunk
    }
  }
}

interface FixtureOptions {
  readonly withRalph?: boolean
  readonly observerFailure?: 'sync' | 'async'
  readonly childDisposeGate?: { readonly wait: Promise<void>; readonly onDispose: (id: string) => void }
  readonly childDisposeFailure?: { readonly reason: unknown }
  readonly disposeGraceMs?: number
}

async function fixture(script: AdapterScript, waitAt: ReadonlySet<number> = new Set(), options: FixtureOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-native-workflow-'))
  const workspace = join(directory, 'work')
  const sessions = join(directory, 'sessions')
  await mkdir(workspace, { recursive: true })
  const scope = new NativeScope()
  const adapter = new NativeWorkflowAdapter(script, waitAt)
  let app: NativeApplication | undefined
  let agents: NativeAgentRegistry | undefined
  let subagents: NativeSubagentOperations | undefined
  let workflow: NativeWorkflowOperations | undefined
  let run: WorkflowRun | undefined
  const model: NativePlugin = {
    apiVersion: 1, name: 'test-native-workflow-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => { context.provide('model', adapter) },
  }
  const capture: NativePlugin = {
    apiVersion: 1, name: 'capture-native-workflow-services', targets: ['host'], requires: ['application', 'agents', 'workflow', 'subagents'], provides: [],
    resolve: () => (context) => {
      app = context.require('application')
      agents = context.require('agents')
      subagents = context.require('subagents')
      workflow = context.require('workflow')
      const start = workflow.start.bind(workflow)
      workflow.start = (name, request) => {
        let acceptedRequest = request
        const observer = request.observer
        if (observer !== undefined && options.observerFailure !== undefined) {
          const notify = (event: string, dispatch: () => void | Promise<void>): void | Promise<void> => {
            const dispatched = Promise.resolve(dispatch())
            if (options.observerFailure === 'sync') {
              void dispatched.catch(() => { /* the wrapper's synchronous failure is the fixture outcome */ })
              throw new Error(`observer-${event}-sync`)
            }
            return dispatched.then(() => { throw new Error(`observer-${event}-async`) })
          }
          const failingObserver: NativeWorkflowObserver = {
            phase: title => notify('phase', () => observer.phase(title)),
            log: message => notify('log', () => observer.log(message)),
            agentStart: agent => notify('agentStart', () => observer.agentStart(agent)),
            agentEnd: agent => notify('agentEnd', () => observer.agentEnd(agent)),
          }
          acceptedRequest = { ...request, observer: failingObserver }
        }
        const accepted = start(name, acceptedRequest)
        run = accepted
        return accepted
      }
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined },
    { plugin: appPlugin, scope, config: { cwd: workspace, provider: 'mock', model: 'fixture', systemPrompt: 'Use the requested tool.', maxSteps: 4 } },
    { plugin: agentPlugin, scope, config: undefined },
    { plugin: sessionExecutionPlugin, scope, config: undefined },
    { plugin: modelExecutionPlugin, scope, config: undefined },
    { plugin: toolsPlugin, scope, config: undefined },
    { plugin: promptPlugin, scope, config: undefined },
    { plugin: subagentsPlugin, scope, config: { providerName: 'spawn' } },
    { plugin: workflowPlugin, scope, config: undefined },
    { plugin: workerPlugin, scope, config: { subagentProvider: 'spawn', disposeGraceMs: options.disposeGraceMs ?? 5000 } },
    { plugin: workflowToolPlugin, scope, config: { provider: 'worker-thread' } },
    ...(options.withRalph ? [{ plugin: ralphToolPlugin, scope, config: {
      workflowProvider: 'worker-thread', subagentProvider: 'spawn', maxRounds: 1,
    } }] : []),
    { plugin: localFilesystemPlugin, scope, config: { cwd: workspace } },
    { plugin: policyPlugin, scope, config: undefined },
    { plugin: storagePlugin, scope, config: { root: sessions, compression: 'none' } },
    { plugin: model, scope, config: undefined },
  ], 'host'))
  await host.start()
  if (app === undefined || agents === undefined || subagents === undefined) throw new Error('native workflow composition is incomplete')
  if (workflow === undefined) throw new Error('native workflow registry is missing')
  if (options.childDisposeGate !== undefined || options.childDisposeFailure !== undefined) {
    const start = subagents.start.bind(subagents)
    subagents.start = async (request, _signal) => {
      const run = await start(request, new AbortController().signal)
      const dispose = run.dispose.bind(run)
      run.dispose = async () => {
        options.childDisposeGate?.onDispose(String(run.id))
        await options.childDisposeGate?.wait
        await dispose()
        if (options.childDisposeFailure !== undefined) throw options.childDisposeFailure.reason
      }
      return run
    }
  }
  return { host, scope, app, agents, subagents, adapter, directory, sessions, workflow, run: () => run }
}

async function readSessions(root: string) {
  const storage = new JsonlSessionBackend({ root, compression: 'none' })
  try {
    const entries = await storage.list()
    return await Promise.all(entries.map(async (entry) => {
      const reader = await storage.open(entry.header.id, 'read')
      try { return { id: entry.header.id, events: (await reader.read()).events } }
      finally { await reader.close() }
    }))
  } finally { await storage.close() }
}

it('runs parallel real WorkerRun children and records their durable Sessions before publishing progress', async () => {
  const state = await fixture([
    toolCallResponse('workflow', 'workflow', { meta: { name: 'parallel-audit', description: 'inspect two items' },
      script: "const results = await parallel([() => agent('inspect first'), () => agent('inspect second')]); return { results }" }),
    textResponse('first result'),
    textResponse('second result'),
    textResponse('workflow finished'),
  ])
  try {
    await state.host.run(state.scope, { kind: 'native-workflow' }, invocation => state.app.run(['run the workflow'], invocation.signal))
    const sessions = await readSessions(state.sessions)
    const parent = sessions.find(session => session.events.some(event => event.type === 'tool-workflow/run-start'))
    expect(parent).toBeDefined()
    const starts = parent!.events.filter(event => event.type === 'tool-workflow/agent-start')
    const ends = parent!.events.filter(event => event.type === 'tool-workflow/agent-end')
    expect(starts).toHaveLength(2)
    expect(ends.map(event => event.data.outcome)).toEqual(['completed', 'completed'])
    expect(parent!.events.find(event => event.type === 'tool-workflow/run-end'))
      .toMatchObject({ type: 'tool-workflow/run-end', data: { stopReason: 'completed' } })
    const children = starts.map(event => event.data.childId)
    expect(new Set(children).size).toBe(2)
    for (const id of children) {
      const child = sessions.find(session => session.id === id)
      expect(child?.events.some(event => event.type === 'subagent/descriptor')).toBe(true)
      expect(child?.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      expect(state.agents.get(NativeAgentId(id))).toBeUndefined()
    }
    expect(state.adapter.requests).toHaveLength(4)
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('runs the native Ralph Consumer from a real structured child report', async () => {
  const state = await fixture([
    toolCallResponse('ralph', 'ralph', { objective: 'inspect the workspace', maxRounds: 1 }),
    toolCallResponse('invalid-report', 'structured_output', {
      status: 'complete', summary: 'workspace inspected', evidence: ['README.md exists'], nextSteps: [],
    }),
    multiToolCallResponse([
      { id: 'report', name: 'structured_output', args: {
        status: 'complete', summary: 'workspace inspected', evidence: ['README.md exists'], nextSteps: [], blocker: '',
      } },
      { id: 'duplicate-report', name: 'structured_output', args: {
        status: 'complete', summary: 'second report', evidence: ['second commit'], nextSteps: [], blocker: '',
      } },
    ]),
    textResponse('Ralph reported completion.'),
  ], new Set(), { withRalph: true })
  try {
    await state.host.run(state.scope, { kind: 'native-ralph' }, invocation =>
      state.app.run(['run one Ralph round'], invocation.signal))
    const childRequest = state.adapter.requests[1]
    expect(childRequest?.tools?.map(tool => tool.name)).toContain('structured_output')
    const sessions = await readSessions(state.sessions)
    const parent = sessions.find(session => session.events.some(event => event.type === 'tool-workflow/run-start'))
    expect(parent).toBeDefined()
    expect(parent?.events.some(event => event.type === 'tool/result' && JSON.stringify(event).includes('Ralph worker reported completion'))).toBe(true)
    const childId = parent?.events.find(event => event.type === 'tool-workflow/agent-start')?.data.childId ?? ''
    const child = sessions.find(session => session.id === childId)
    expect(child?.events.filter(event => event.type === 'tool/call' && event.data.name === 'structured_output')).toHaveLength(3)
    const structuredResults = child?.events.filter(event => event.type === 'tool/result') ?? []
    expect(structuredResults).toHaveLength(3)
    expect(JSON.stringify(structuredResults[0])).toContain('"callId":"invalid-report"')
    expect(JSON.stringify(structuredResults[0])).toContain('"isError":true')
    expect(JSON.stringify(structuredResults[1])).toContain('"callId":"report"')
    expect(JSON.stringify(structuredResults[1])).toContain('"isError":false')
    expect(JSON.stringify(structuredResults[2])).toContain('"callId":"duplicate-report"')
    expect(JSON.stringify(structuredResults[2])).toContain('"isError":true')
    expect(child?.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(childId).not.toBe('')
    expect(state.agents.get(NativeAgentId(childId))).toBeUndefined()
    expect(state.adapter.requests).toHaveLength(4)
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('rejects a completed structured child without an accepted report', async () => {
  const state = await fixture([
    toolCallResponse('ralph-no-report', 'ralph', { objective: 'inspect the workspace', maxRounds: 1 }),
    textResponse('The inspection is complete.'),
    textResponse('No structured report was accepted.'),
  ], new Set(), { withRalph: true })
  try {
    await state.host.run(state.scope, { kind: 'native-ralph-no-report' }, invocation =>
      state.app.run(['run one Ralph round without a report'], invocation.signal))
    const sessions = await readSessions(state.sessions)
    const parent = sessions.find(session => session.events.some(event => event.type === 'tool-workflow/run-start'))
    expect(parent?.events.find(event => event.type === 'tool-workflow/run-end'))
      .toMatchObject({ type: 'tool-workflow/run-end', data: { stopReason: 'completed' } })
    expect(parent?.events.some(event => event.type === 'tool/result'
      && JSON.stringify(event).includes('Ralph round 1 child failed'))).toBe(true)
    const childId = parent?.events.find(event => event.type === 'tool-workflow/agent-start')?.data.childId ?? ''
    const child = sessions.find(session => session.id === childId)
    expect(child?.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(state.agents.get(NativeAgentId(childId))).toBeUndefined()
    expect(state.adapter.requests).toHaveLength(3)
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it.each(['sync', 'async'] as const)('contains %s observer failures without breaking real worker events or cleanup', async (failure) => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const state = await fixture([
    toolCallResponse('workflow', 'workflow', { meta: { name: 'observer-audit', description: 'exercise every observer' },
      script: "phase('working'); log('progress'); const result = await agent('inspect the workspace'); return { result }" }),
    textResponse('child finished'),
    textResponse('workflow finished'),
  ], new Set(), { observerFailure: failure })
  try {
    await state.host.run(state.scope, { kind: `native-workflow-observer-${failure}` }, invocation =>
      state.app.run(['exercise workflow observer delivery'], invocation.signal))
    const sessions = await readSessions(state.sessions)
    const parent = sessions.find(session => session.events.some(event => event.type === 'tool-workflow/run-start'))
    expect(parent?.events.filter(event => event.type === 'tool-workflow/agent-start')).toHaveLength(1)
    expect(parent?.events.filter(event => event.type === 'tool-workflow/agent-end')).toHaveLength(1)
    expect(parent?.events.find(event => event.type === 'tool-workflow/run-end'))
      .toMatchObject({ type: 'tool-workflow/run-end', data: { stopReason: 'completed' } })
    expect(warn.mock.calls.filter(([message]) => String(message).includes('observer') && String(message).includes(failure === 'sync' ? 'threw' : 'rejected'))).toHaveLength(4)
  } finally {
    warn.mockRestore()
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('cancels and drains an accepted child before closing the durable workflow record', async () => {
  const state = await fixture([
    toolCallResponse('workflow', 'workflow', { meta: { name: 'cancel-audit', description: 'stop cleanly' },
      script: "await agent('wait for cancellation'); return { unreachable: true }" }),
    textResponse('unused child result'),
    textResponse('workflow cancelled'),
  ], new Set([1]))
  try {
    const running = state.host.run(state.scope, { kind: 'native-workflow-cancel' }, invocation =>
      state.app.run(['start and cancel the workflow'], invocation.signal))
    await vi.waitFor(() => { expect(state.adapter.requests).toHaveLength(2) }, { timeout: 5_000 })
    const run = state.run()
    expect(run).toBeDefined()
    run?.cancel('cancelled by test')
    await running
    const sessions = await readSessions(state.sessions)
    const parent = sessions.find(session => session.events.some(event => event.type === 'tool-workflow/run-start'))
    expect(parent?.events.some(event => event.type === 'tool-workflow/agent-start')).toBe(true)
    expect(parent?.events.filter(event => event.type === 'tool-workflow/agent-end').map(event => event.data.outcome)).toEqual(['cancelled'])
    expect(parent?.events.find(event => event.type === 'tool-workflow/run-end'))
      .toMatchObject({ type: 'tool-workflow/run-end', data: { stopReason: 'cancelled' } })
    const childId = parent?.events.find(event => event.type === 'tool-workflow/agent-start')?.data.childId ?? ''
    const child = sessions.find(session => session.id === childId)
    expect(child?.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
    expect(state.agents.get(NativeAgentId(childId))).toBeUndefined()
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('keeps native disposal pending until concurrent cancelled child Sessions release their writers', async () => {
  const disposalGate = Promise.withResolvers<undefined>()
  const disposedIds: string[] = []
  const state = await fixture([
    toolCallResponse('workflow', 'workflow', { meta: { name: 'cleanup-audit', description: 'release two children' },
      script: "await parallel([() => agent('wait for cancellation one'), () => agent('wait for cancellation two')]); return { unreachable: true }" }),
    textResponse('unused first result'),
    textResponse('unused second result'),
    textResponse('workflow cancelled'),
  ], new Set([1, 2]), { disposeGraceMs: 40, childDisposeGate: {
    wait: disposalGate.promise,
    onDispose: (id) => { disposedIds.push(id) },
  } })
  let runSettled = false
  try {
    const running = state.host.run(state.scope, { kind: 'native-workflow-delayed-cleanup' }, invocation =>
      state.app.run(['start concurrent children and cancel the workflow'], invocation.signal))
    void running.then(() => { runSettled = true }, () => { runSettled = true })
    await vi.waitFor(() => { expect(state.adapter.requests).toHaveLength(3) }, { timeout: 5_000 })
    const run = state.run()
    expect(run).toBeDefined()
    run?.cancel('cancel while two child Sessions are active')
    const result = await run!.result
    expect(result.stopReason).toBe('cancelled')
    await vi.waitFor(() => { expect(new Set(disposedIds).size).toBe(2) }, { timeout: 5_000 })
    expect(runSettled).toBe(false)
    expect(disposedIds).toHaveLength(2)
    for (const id of disposedIds) expect(state.agents.get(NativeAgentId(id))).toBeDefined()

    disposalGate.resolve(undefined)
    await running
    expect(runSettled).toBe(true)
    const sessions = await readSessions(state.sessions)
    const parent = sessions.find(session => session.events.some(event => event.type === 'tool-workflow/run-start'))
    expect(parent?.events.find(event => event.type === 'tool-workflow/run-end'))
      .toMatchObject({ type: 'tool-workflow/run-end', data: { stopReason: 'cancelled' } })
    expect(disposedIds).toHaveLength(2)
    for (const id of disposedIds) {
      const child = sessions.find(session => session.id === id)
      expect(child?.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
      expect(state.agents.get(NativeAgentId(id))).toBeUndefined()
    }
  } finally {
    disposalGate.resolve(undefined)
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('retains native workflow ownership when child disposal rejects undefined', async () => {
  const state = await fixture([
    toolCallResponse('workflow', 'workflow', { meta: { name: 'undefined-cleanup', description: 'check cleanup ownership' },
      script: "const result = await agent('inspect the workspace'); return { result }" }),
    textResponse('child finished'),
    textResponse('continue after the workflow tool reports its cleanup failure'),
  ], new Set(), { childDisposeFailure: { reason: undefined } })
  let stopFailure: unknown
  try {
    await state.host.run(state.scope, { kind: 'native-workflow-undefined-cleanup' }, invocation =>
      state.app.run(['run a workflow whose child disposer rejects undefined'], invocation.signal))
    const run = state.run()
    expect(run).toBeDefined()
    expect((await run!.result).stopReason).toBe('error')
    await expect(run!.dispose()).rejects.toBeInstanceOf(AggregateError)
    const sessions = await readSessions(state.sessions)
    const parent = sessions.find(session => session.events.some(event => event.type === 'tool-workflow/run-start'))
    expect(parent?.events.find(event => event.type === 'tool-workflow/run-end')).toBeUndefined()
    expect(state.adapter.requests).toHaveLength(3)
  } finally {
    try { await state.host.stop() } catch (error: unknown) { stopFailure = error }
    await rm(state.directory, { recursive: true, force: true })
  }
  expect(stopFailure).toBeInstanceOf(AggregateError)
})
