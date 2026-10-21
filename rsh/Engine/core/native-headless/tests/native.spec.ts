/** Native Agent, model, filesystem tool, and released Session storage in one host. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativeApplication, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { LocalFileSystemBackend } from '@deepseek-ai/dsh-fs-local/backend'
import { plugin as policyPlugin } from '@deepseek-ai/dsh-fs-observation-policy/native'
import { plugin as storagePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as modelExecutionPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import type { NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { plugin as approvalPlugin } from '@deepseek-ai/dsh-native-approval/native'
import type { NativeApprovalServiceDefinition } from '@deepseek-ai/dsh-approval-definition'
import { plugin as codeToolPlugin } from '@deepseek-ai/dsh-tool-code-runtime/native'
import { plugin as codeRuntimePlugin } from '@deepseek-ai/dsh-native-code-runtime/native'
import { plugin as instructionsPlugin } from '@deepseek-ai/dsh-agent-instructions/native'
import { plugin as timeContextPlugin } from '@deepseek-ai/dsh-native-time-context/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import type { NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { NativeRootExecutionOperations, NativeRootRouteId } from '@deepseek-ai/dsh-native-session-execution'
import { MockAdapter, maxTokensResponse, textResponse, toolCallResponse } from '../../agent-loop/tests/mock-adapter.ts'
import { plugin as appPlugin } from '../src/native.ts'

async function fixture(
  script: ConstructorParameters<typeof MockAdapter>[0],
  options: { approvalPolicy?: 'ask' | 'never'; timeContext?: { timeZone: string; refreshIntervalMs?: number }; instructions?: boolean; ptc?: boolean; maxSteps?: number; directory?: string; workspaceWriteRoot?: string } = {},
) {
  const directory = options.directory ?? await mkdtemp(join(tmpdir(), 'rsh-native-headless-'))
  const workspace = join(directory, 'work')
  const sessions = join(directory, 'sessions')
  await import('node:fs/promises').then(fs => fs.mkdir(workspace, { recursive: true }))
  const scope = new NativeScope()
  const adapter = new MockAdapter(script)
  let app: NativeApplication | undefined
  let filesystem: LocalFileSystemBackend | undefined
  let agents: NativeAgentRegistry | undefined
  let tools: NativeToolRegistry | undefined
  let rootExecution: NativeRootExecutionOperations | undefined
  let approval: NativeApprovalServiceDefinition | undefined
  const model: NativePlugin = {
    apiVersion: 1, name: 'test-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => { context.provide('model', adapter) },
  }
  const capture: NativePlugin = {
    apiVersion: 1, name: 'test-capture', targets: ['host'], requires: ['application', 'fs', 'agents', 'tools', 'rootExecution'], optional: ['approval'], provides: [],
    resolve: () => (context) => {
      app = context.require('application')
      const provided = context.require('fs')
      if (!(provided instanceof LocalFileSystemBackend)) throw new Error('missing local filesystem')
      filesystem = provided
      agents = context.require('agents')
      tools = context.require('tools')
      rootExecution = context.require('rootExecution')
      approval = context.optional('approval')
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined },
    { plugin: appPlugin, scope, config: { cwd: workspace, provider: 'mock', model: 'fixture', systemPrompt: 'Use tools.', maxSteps: options.maxSteps ?? 4, ...(options.ptc ? { builtinTools: false } : {}),
      ...options.workspaceWriteRoot === undefined ? {} : { workspaceWriteRoot: options.workspaceWriteRoot } } },
    { plugin: agentPlugin, scope, config: undefined },
    { plugin: modelExecutionPlugin, scope, config: undefined },
    { plugin: codeRuntimePlugin, scope, config: { computeMs: 2_000, maxWallMs: 2_000 } },
    ...(options.ptc ? [{ plugin: codeToolPlugin, scope, config: undefined }] : []),
    ...(options.timeContext === undefined ? [] : [{ plugin: timeContextPlugin, scope, config: options.timeContext }]),
    ...(options.instructions ? [{ plugin: instructionsPlugin, scope, config: { maxBytes: 65_536, dshHome: directory } }] : []),
    { plugin: toolsPlugin, scope, config: undefined },
    { plugin: policyPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: workspace } },
    { plugin: storagePlugin, scope, config: { root: sessions, compression: 'none' } },
    { plugin: model, scope, config: undefined },
    ...(options.approvalPolicy === undefined ? [] : [{ plugin: approvalPlugin, scope, config: { policy: options.approvalPolicy } }]),
  ], 'host'))
  await host.start()
  if (app === undefined || filesystem === undefined || agents === undefined || tools === undefined || rootExecution === undefined) throw new Error('missing native application dependencies')
  return { host, scope, app, filesystem, agents, tools, rootExecution, approval, adapter, directory, workspace, sessions }
}

it('captures resolved builtin tool defaults and explicit route selection', async () => {
  for (const [options, expected] of [[{}, true], [{ ptc: true }, false]] as const) {
    const state = await fixture([], options)
    try {
      expect(state.rootExecution.resolve(brandString<NativeRootRouteId>('root')).configuration.builtinTools).toBe(expected)
    } finally {
      await state.host.stop()
      await rm(state.directory, { recursive: true, force: true })
    }
  }
})

it('logs the model-visible request and tool result, then resumes the same stored Session', async () => {
  const state = await fixture([
    toolCallResponse('write-1', 'write_file', { path: 'created.txt', content: 'native content' }),
    textResponse('created'),
    textResponse('resumed'),
  ])
  try {
    await state.host.run(state.scope, { kind: 'test' }, invocation => state.app.run(['create', 'the', 'file'], invocation.signal))
    expect(await readFile(join(state.workspace, 'created.txt'), 'utf8')).toBe('native content')
    expect(state.adapter.requests).toHaveLength(2)
    expect(state.adapter.requests[0]?.messages.some(message => message.role === 'user')).toBe(true)
    expect(state.adapter.requests[1]?.messages.some(message => message.content.some(block => block.type === 'tool-result'))).toBe(true)
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const snapshots = await storage.list()
      expect(snapshots).toHaveLength(1)
      const id = snapshots[0]?.header.id
      if (id === undefined) throw new Error('missing Session id')
      await state.host.run(state.scope, { kind: 'resume' }, invocation => state.app.run(['--resume', id, 'continue'], invocation.signal))
      const reader = await storage.open(SessionId(id), 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'turn/end')).toHaveLength(2)
        expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
        expect(events.filter(event => event.type === 'request/header')).toHaveLength(2)
        expect(events.filter(event => event.type === 'request/header').at(-1)).toMatchObject({ data: { reason: 'resume' } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('waits for an admitted model stream and persists the cancelled turn before shutdown', async () => {
  const entered = Promise.withResolvers<boolean>()
  const aborted = Promise.withResolvers<boolean>()
  const release = Promise.withResolvers<boolean>()
  const state = await fixture(['hang'])
  const model = state.adapter
  model.stream = async function* (options) {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'partial' }
    await new Promise<void>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        aborted.resolve(true)
        void release.promise.then(() => { reject(new Error('stream stopped')) })
      }, { once: true })
      entered.resolve(true)
    })
  }
  try {
    const running = state.host.run(state.scope, { kind: 'cancel-test' }, invocation => state.app.run(['cancel', 'me'], invocation.signal))
    await entered.promise
    let stopped = false
    const stopping = state.host.stop().then(() => { stopped = true })
    await aborted.promise
    expect(stopped).toBe(false)
    release.resolve(true)
    await expect(running).rejects.toThrow()
    await stopping
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('cancelled Session was not stored')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
        expect(events.some(event => event.type === 'assistant/attempt')).toBe(true)
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    release.resolve(true)
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('repairs a persisted tool call when shutdown interrupts the file write', async () => {
  const state = await fixture([toolCallResponse('write-1', 'write_file', { path: 'interrupted.txt', content: 'uncommitted' })])
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  state.filesystem.internals.inspectTemp = async () => { entered.resolve(undefined); await release.promise }
  try {
    const running = state.host.run(state.scope, { kind: 'cancel-write' }, invocation => state.app.run(['create', 'a', 'file'], invocation.signal))
    await entered.promise
    const stopping = state.host.stop()
    release.resolve(undefined)
    await expect(running).rejects.toThrow()
    await stopping
    await expect(readFile(join(state.workspace, 'interrupted.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('interrupted Session was not stored')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'tool/call')).toHaveLength(1)
        expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
        expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    release.resolve(undefined)
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('supports empty writes, denies paths outside the workspace, and records both tool outcomes', async () => {
  const state = await fixture([
    toolCallResponse('empty', 'write_file', { path: 'empty.txt', content: '' }),
    toolCallResponse('outside', 'write_file', { path: '../outside.txt', content: 'denied' }),
    textResponse('done'),
  ])
  try {
    await state.host.run(state.scope, { kind: 'tools' }, invocation => state.app.run(['check', 'tools'], invocation.signal))
    expect(await readFile(join(state.workspace, 'empty.txt'), 'utf8')).toBe('')
    await expect(readFile(join(state.directory, 'outside.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(state.adapter.requests[2]?.messages.some(message => message.content.some(block => block.type === 'tool-result'))).toBe(true)
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('missing Session id')
      const reader = await storage.open(id, 'read')
      try {
        const results = (await reader.read()).events.filter(event => event.type === 'tool/result')
        expect(results).toHaveLength(2)
        expect(results[0]?.type === 'tool/result' && results[0].data.message.content[0]?.type === 'tool-result' && results[0].data.message.content[0].isError).toBe(false)
        expect(results[1]).toMatchObject({ type: 'tool/result', data: { error: { code: 'FS_SANDBOX_DENIED' } } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('keeps SDK child writes inside the parent-authorized workspace root even with fs-local', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-native-headless-write-root-'))
  const workspace = join(directory, 'work')
  const writeRoot = join(workspace, 'authorized')
  await import('node:fs/promises').then(fs => fs.mkdir(writeRoot, { recursive: true }))
  const state = await fixture([
    toolCallResponse('inside', 'write_file', { path: 'authorized/child.txt', content: 'allowed' }),
    toolCallResponse('outside', 'write_file', { path: 'denied.txt', content: 'blocked' }),
    textResponse('done'),
  ], { directory, workspaceWriteRoot: writeRoot })
  try {
    await state.host.run(state.scope, { kind: 'child-write-fence' }, invocation => state.app.run(['write under parent grant'], invocation.signal))
    expect(await readFile(join(writeRoot, 'child.txt'), 'utf8')).toBe('allowed')
    await expect(readFile(join(workspace, 'denied.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('missing fenced Session id')
      const reader = await storage.open(id, 'read')
      try {
        const results = (await reader.read()).events.filter(event => event.type === 'tool/result')
        expect(results).toHaveLength(2)
        expect(results[1]).toMatchObject({ type: 'tool/result', data: { error: { code: 'FS_SANDBOX_DENIED' } } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('projects a bounded worker-thread code result through the Session tool sequence', async () => {
  const state = await fixture([
    toolCallResponse('code-1', 'run_code', { program: 'console.log("native code"); return { total: 6 * 7 }' }),
    textResponse('code completed'),
  ])
  try {
    await state.host.run(state.scope, { kind: 'code-runtime' }, invocation => state.app.run(['calculate'], invocation.signal))
    expect(state.adapter.requests[0]?.tools?.map(tool => tool.name)).toContain('run_code')
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('code Session was not stored')
      const reader = await storage.open(id, 'read')
      try {
        const result = (await reader.read()).events.find(event => event.type === 'tool/result')
        expect(result).toMatchObject({ data: { message: { content: [{ type: 'tool-result', content: [{ type: 'text', text: '{"logs":["native code"],"value":{"total":42}}' }] }] } } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('projects a program failure as an explicit native code-runtime tool error', async () => {
  const state = await fixture([
    toolCallResponse('code-failure', 'run_code', { program: 'throw new Error("calculation failed")' }),
    textResponse('code failure recorded'),
  ])
  try {
    await state.host.run(state.scope, { kind: 'code-runtime-failure' }, invocation => state.app.run(['calculate'], invocation.signal))
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('failed code Session was not stored')
      const reader = await storage.open(id, 'read')
      try {
        const result = (await reader.read()).events.find(event => event.type === 'tool/result')
        expect(result).toMatchObject({ data: {
          error: { name: 'NativeCodeRuntimeError', code: 'CODE_RUNTIME_EXCEPTION' },
          message: { content: [{ type: 'tool-result', isError: true }] },
        } })
        expect(JSON.stringify(result)).toContain('calculation failed')
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('persists native time context before the model reads the request', async () => {
  const state = await fixture([textResponse('time recorded')], { timeContext: { timeZone: 'UTC', refreshIntervalMs: 60_000 } })
  try {
    await state.host.run(state.scope, { kind: 'time-context' }, invocation => state.app.run(['report', 'time'], invocation.signal))
    expect(state.adapter.requests[0]?.messages.some(message =>
      message.role === 'user' && message.source.kind === 'plugin' && message.source.plugin === 'native-time-context',
    )).toBe(true)
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('time-context Session was not stored')
      const reader = await storage.open(id, 'read')
      try {
        expect((await reader.read()).events.some(event =>
          event.type === 'user/message'
          && event.data.source.kind === 'plugin'
          && event.data.source.plugin === 'native-time-context',
        )).toBe(true)
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('rejects write_file under the installed never approval policy and persists its paired audit', async () => {
  const state = await fixture([
    toolCallResponse('write-denied', 'write_file', { path: 'denied.txt', content: 'must not exist' }),
    textResponse('denied'),
  ], { approvalPolicy: 'never' })
  try {
    await state.host.run(state.scope, { kind: 'approval-write' }, invocation => state.app.run(['try', 'a', 'write'], invocation.signal))
    await expect(readFile(join(state.workspace, 'denied.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('approval Session was not stored')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'native-approval/asked')).toMatchObject([{
          data: { toolName: 'write_file', callId: 'write-denied', reason: 'Writing a file changes the selected workspace.' },
        }])
        expect(events.filter(event => event.type === 'native-approval/decided')).toMatchObject([{ data: { policy: 'never', outcome: 'rejected' } }])
        expect(events.find(event => event.type === 'tool/result')).toMatchObject({ data: { error: { code: 'APPROVAL_REJECTED' } } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('durably records the approval question before dispatch and its grant before the tool runs', async () => {
  const state = await fixture([
    toolCallResponse('guarded-approval', 'guarded', {}),
    textResponse('guarded complete'),
  ], { approvalPolicy: 'ask' })
  const approval = state.approval
  if (approval === undefined) throw new Error('approval Provider was not installed')
  const readAudit = async (): Promise<unknown[]> => {
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({
      root: state.sessions,
      compression: 'none',
    })
    try {
      const entry = (await storage.list())[0]
      if (entry === undefined) throw new Error('approval Session was not durable before answerer dispatch')
      const reader = await storage.open(entry.header.id, 'read')
      try {
        return (await reader.read()).events.filter(event => (
          event.type === 'native-approval/asked' || event.type === 'native-approval/decided'
        ))
      } finally { await reader.close() }
    } finally { await storage.close() }
  }
  let requestId: string | undefined
  let sawAskedBeforeAnswer = false
  let sawDecisionBeforeExecution = false
  let executed = false
  const removeAnswerer = approval.registerAnswerer(async (request) => {
    requestId = request.id
    const events = await readAudit()
    sawAskedBeforeAnswer = events.some(event => (
      typeof event === 'object' && event !== null && 'type' in event && event.type === 'native-approval/asked'
      && 'data' in event && typeof event.data === 'object' && event.data !== null && 'id' in event.data
      && event.data.id === request.id
    )) && !events.some(event => typeof event === 'object' && event !== null && 'type' in event && event.type === 'native-approval/decided')
    return 'allowed-once' as const
  })
  const removeTool = state.tools.register({
    schema: { name: 'guarded', description: 'A protected fixture contribution.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
    approval: { reason: 'This contribution changes protected state.' },
    async execute() {
      const events = await readAudit()
      sawDecisionBeforeExecution = events.some(event => (
        typeof event === 'object' && event !== null && 'type' in event && event.type === 'native-approval/decided'
        && 'data' in event && typeof event.data === 'object' && event.data !== null && 'id' in event.data
        && event.data.id === requestId && 'outcome' in event.data && event.data.outcome === 'allowed-once'
      ))
      executed = true
      return { content: [{ type: 'text', text: 'guarded complete' }], isError: false }
    },
  })
  try {
    await state.host.run(state.scope, { kind: 'approval-durability' }, invocation => state.app.run(['invoke', 'guarded'], invocation.signal))
    expect(sawAskedBeforeAnswer).toBe(true)
    expect(sawDecisionBeforeExecution).toBe(true)
    expect(executed).toBe(true)
  } finally {
    removeAnswerer()
    await removeTool()
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('records a max-token model finish without claiming normal completion', async () => {
  const state = await fixture([maxTokensResponse('partial')])
  try {
    await state.host.run(state.scope, { kind: 'max-tokens' }, invocation => state.app.run(['continue'], invocation.signal))
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('missing Session id')
      const reader = await storage.open(id, 'read')
      try {
        expect((await reader.read()).events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'max-tokens' } } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('runs registered native tools under the exact live Agent initiator', async () => {
  const state = await fixture([
    toolCallResponse('identity-1', 'identity', {}),
    textResponse('identity confirmed'),
  ])
  let initiatedAgent: unknown
  const dispose = state.tools.register({
    schema: { name: 'identity', description: 'Confirm the current native Agent.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
    async execute(call) {
      expect(state.agents.requireInitiator()).toBe(call.agent)
      expect(state.agents.get(call.agent.id)).toBe(call.agent)
      initiatedAgent = call.agent
      return { content: [{ type: 'text', text: String(call.agent.id) }], isError: false }
    },
  })
  try {
    await state.host.run(state.scope, { kind: 'identity' }, invocation => state.app.run(['confirm', 'identity'], invocation.signal))
    const resident = state.agents.list()
    expect(resident).toHaveLength(1)
    expect(resident[0]).toBe(initiatedAgent)
  } finally {
    await dispose()
    await state.host.stop()
    expect(state.agents.list()).toEqual([])
    await rm(state.directory, { recursive: true, force: true })
  }
})

it('stops a protected contribution before its executor under the selected approval policy', async () => {
  const state = await fixture([
    toolCallResponse('guarded-1', 'guarded', {}),
    textResponse('guarded denied'),
  ], { approvalPolicy: 'never' })
  let executed = false
  const dispose = state.tools.register({
    schema: { name: 'guarded', description: 'A protected fixture contribution.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
    approval: { reason: 'The fixture contribution changes protected state.' },
    async execute() {
      executed = true
      return { content: [{ type: 'text', text: 'unexpected' }], isError: false }
    },
  })
  try {
    await state.host.run(state.scope, { kind: 'approval-contribution' }, invocation => state.app.run(['invoke', 'guarded'], invocation.signal))
    expect(executed).toBe(false)
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('protected contribution Session was not stored')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'native-approval/asked')).toMatchObject([{
          data: { toolName: 'guarded', reason: 'The fixture contribution changes protected state.' },
        }])
        expect(events.find(event => event.type === 'tool/result')).toMatchObject({ data: { error: { code: 'APPROVAL_REJECTED' } } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await dispose()
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})


it('persists native workspace instructions and reconciles an offline edit on resume', async () => {
  const state = await fixture([textResponse('first'), textResponse('second')], { instructions: true })
  const fs = await import('node:fs/promises')
  try {
    await fs.writeFile(join(state.workspace, 'AGENTS.md'), 'Initial workspace rule.')
    await state.host.run(state.scope, { kind: 'instructions' }, invocation => state.app.run(['first'], invocation.signal))
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl/native')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('missing Session id')
      await fs.writeFile(join(state.workspace, 'AGENTS.md'), 'Updated workspace rule.')
      await state.host.run(state.scope, { kind: 'instructions-resume' }, invocation => state.app.run(['--resume', id, 'second'], invocation.signal))
      expect(state.adapter.requests[0]?.messages.some(message => JSON.stringify(message).includes('Initial workspace rule.'))).toBe(true)
      expect(state.adapter.requests[1]?.messages.some(message => JSON.stringify(message).includes('Updated workspace rule.'))).toBe(true)
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        const contexts = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'agent-instructions')
        expect(contexts).toHaveLength(2)
        expect(contexts[1]).toMatchObject({ data: { source: { changes: [{ action: 'replace', path: 'AGENTS.md' }] } } })
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})


it.each([false, true])('projects nested instruction discovery and removal after accepted file results (PTC %s)', async (ptc) => {
  let state = await fixture([
    ptc ? toolCallResponse('code-1', 'run_code', { code: "return await tools.read({ file_path: 'nested/file.txt' })", description: 'Read nested file.' })
      : toolCallResponse('read-1', 'read', { file_path: 'nested/file.txt' }),
  ], { instructions: true, maxSteps: 1, ptc })
  const fs = await import('node:fs/promises')
  try {
    await fs.mkdir(join(state.workspace, 'nested'))
    await fs.writeFile(join(state.workspace, 'AGENTS.md'), 'Baseline rule.')
    await fs.writeFile(join(state.workspace, 'CLAUDE.md'), '  Baseline rule.  ')
    await fs.writeFile(join(state.workspace, 'nested', 'AGENTS.md'), 'Nested rule.')
    const registerRead = (remove: boolean): void => {
      state.tools.registerValueTool({
        schema: { name: 'read', description: 'Read fixture.', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'], additionalProperties: false } },
        output: { schema: { type: 'string' }, render: (_call, value) => ({ content: [{ type: 'text', text: value as string }], isError: false }) },
        execute: async () => {
          if (remove) await fs.unlink(join(state.workspace, 'nested', 'AGENTS.md'))
          return 'file contents'
        },
      }, state.scope)
    }
    registerRead(false)
    await state.host.run(state.scope, { kind: 'nested-instructions' }, invocation => state.app.run(['inspect nested file'], invocation.signal))
    const initial = JSON.stringify(state.adapter.requests[0]?.messages)
    expect(initial).toContain('Baseline rule.')
    expect(initial).not.toContain('Instructions from: CLAUDE.md')
    expect(initial).not.toContain('Nested rule.')
    const storage = new (await import('@deepseek-ai/dsh-session-persistence-jsonl/native')).JsonlSessionBackend({ root: state.sessions, compression: 'none' })
    const id = (await storage.list())[0]?.header.id
    await storage.close()
    if (id === undefined) throw new Error('missing Session id')
    const directory = state.directory
    await state.host.stop()
    state = await fixture([
      toolCallResponse('read-2', 'read', { file_path: 'nested/file.txt' }),
      textResponse('done'),
    ], { instructions: true, maxSteps: 1, directory, ptc })
    registerRead(true)
    await state.host.run(state.scope, { kind: 'nested-instructions-cold-resume' }, invocation => state.app.run(['--resume', id, 'continue'], invocation.signal))
    expect(JSON.stringify(state.adapter.requests[0]?.messages)).toContain('Nested rule.')
    await state.host.run(state.scope, { kind: 'nested-instructions-removal' }, invocation => state.app.run(['--resume', id, 'finish'], invocation.signal))
    const final = JSON.stringify(state.adapter.requests[1]?.messages)
    expect(final).toContain('Instructions removed:')
    expect(final.match(/Nested rule\./g)).toHaveLength(1)
  } finally {
    await state.host.stop()
    await rm(state.directory, { recursive: true, force: true })
  }
})
