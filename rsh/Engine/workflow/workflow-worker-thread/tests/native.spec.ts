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
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { plugin as appPlugin } from '../../../core/native-headless/src/native.ts'
import type { NativeWorkflowOperations, WorkflowRun } from '@deepseek-ai/dsh-workflow/native'

type AdapterScript = ConstructorParameters<typeof MockAdapter>[0]

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

async function fixture(script: AdapterScript, waitAt: ReadonlySet<number> = new Set(), withRalph = false) {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-native-workflow-'))
  const workspace = join(directory, 'work')
  const sessions = join(directory, 'sessions')
  await mkdir(workspace, { recursive: true })
  const scope = new NativeScope()
  const adapter = new NativeWorkflowAdapter(script, waitAt)
  let app: NativeApplication | undefined
  let agents: NativeAgentRegistry | undefined
  let workflow: NativeWorkflowOperations | undefined
  let run: WorkflowRun | undefined
  const model: NativePlugin = {
    apiVersion: 1, name: 'test-native-workflow-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => { context.provide('model', adapter) },
  }
  const capture: NativePlugin = {
    apiVersion: 1, name: 'capture-native-workflow-services', targets: ['host'], requires: ['application', 'agents', 'workflow'], provides: [],
    resolve: () => (context) => {
      app = context.require('application')
      agents = context.require('agents')
      workflow = context.require('workflow')
      const start = workflow.start.bind(workflow)
      workflow.start = (name, request) => {
        const accepted = start(name, request)
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
    { plugin: workerPlugin, scope, config: { subagentProvider: 'spawn' } },
    { plugin: workflowToolPlugin, scope, config: { provider: 'worker-thread' } },
    ...(withRalph ? [{ plugin: ralphToolPlugin, scope, config: {
      workflowProvider: 'worker-thread', subagentProvider: 'spawn', maxRounds: 1,
    } }] : []),
    { plugin: localFilesystemPlugin, scope, config: { cwd: workspace } },
    { plugin: policyPlugin, scope, config: undefined },
    { plugin: storagePlugin, scope, config: { root: sessions, compression: 'none' } },
    { plugin: model, scope, config: undefined },
  ], 'host'))
  await host.start()
  if (app === undefined || agents === undefined) throw new Error('native workflow composition is incomplete')
  if (workflow === undefined) throw new Error('native workflow registry is missing')
  return { host, scope, app, agents, adapter, directory, sessions, workflow, run: () => run }
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
    expect(ends).toEqual(expect.arrayContaining([
      expect.objectContaining({ data: expect.objectContaining({ outcome: 'completed' }) }),
      expect.objectContaining({ data: expect.objectContaining({ outcome: 'completed' }) }),
    ]))
    expect(parent!.events.find(event => event.type === 'tool-workflow/run-end'))
      .toMatchObject({ type: 'tool-workflow/run-end', data: { stopReason: 'completed' } })
    const children = starts.map(event => String((event.data as { childId: string }).childId))
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
    toolCallResponse('report', 'structured_output', {
      status: 'complete', summary: 'workspace inspected', evidence: ['README.md exists'], nextSteps: [], blocker: '',
    }),
    textResponse('Ralph reported completion.'),
  ], new Set(), true)
  try {
    await state.host.run(state.scope, { kind: 'native-ralph' }, invocation =>
      state.app.run(['run one Ralph round'], invocation.signal))
    const childRequest = state.adapter.requests[1]
    expect(childRequest?.tools?.map(tool => tool.name)).toContain('structured_output')
    const sessions = await readSessions(state.sessions)
    const parent = sessions.find(session => session.events.some(event => event.type === 'tool-workflow/run-start'))
    expect(parent).toBeDefined()
    expect(parent?.events.some(event => event.type === 'tool/result' && JSON.stringify(event).includes('Ralph worker reported completion'))).toBe(true)
    const childId = String((parent?.events.find(event => event.type === 'tool-workflow/agent-start')?.data as { childId: string } | undefined)?.childId ?? '')
    const child = sessions.find(session => session.id === childId)
    expect(child?.events).toContainEqual(expect.objectContaining({ type: 'tool/call', data: expect.objectContaining({ name: 'structured_output' }) }))
    expect(child?.events.some(event => event.type === 'tool/result' && JSON.stringify(event).includes('"isError":false'))).toBe(true)
    expect(child?.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(childId).not.toBe('')
    expect(state.agents.get(NativeAgentId(childId))).toBeUndefined()
    expect(state.adapter.requests).toHaveLength(3)
  } finally {
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
    expect(parent?.events).toContainEqual(expect.objectContaining({ type: 'tool-workflow/agent-end', data: expect.objectContaining({ outcome: 'cancelled' }) }))
    expect(parent?.events.find(event => event.type === 'tool-workflow/run-end'))
      .toMatchObject({ type: 'tool-workflow/run-end', data: { stopReason: 'cancelled' } })
    const childId = String((parent?.events.find(event => event.type === 'tool-workflow/agent-start')?.data as { childId: string }).childId)
    const child = sessions.find(session => session.id === childId)
    expect(child?.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
    expect(state.agents.get(NativeAgentId(childId))).toBeUndefined()
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})
