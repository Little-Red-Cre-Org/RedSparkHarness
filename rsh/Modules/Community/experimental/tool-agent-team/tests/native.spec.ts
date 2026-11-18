/** Native Team tools over a fake exact-scope registry and Team service. */
import { describe, expect, it, vi } from 'vitest'
import { NativeAgentId } from '@redspark/rsh-native-agent'
import type { NativeToolExecution } from '@redspark/rsh-native-tools'
import { plugin, resolveNativeTeamToolsConfig } from '../src/index.ts'

const signal = new AbortController().signal

function member(overrides: Record<string, unknown> = {}) {
  return {
    id: 'member-1',
    name: 'worker',
    role: 'teammate' as const,
    status: 'idle' as const,
    diagnostics: [],
    ...overrides,
  }
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    revision: 1,
    subject: 'Subject',
    description: 'Description',
    status: 'pending' as const,
    blockedBy: [],
    writeScopes: [],
    ready: true,
    writeScopeWarnings: [],
    ...overrides,
  }
}

/**
 * Install the plugin against captured registries.
 * @param failAt - one-based tool registration that should fail.
 * @param sink - receives the prompt disposals observed during rollback.
 * @returns registered contributions, lifecycle handlers, and the fake Team service.
 */
function install(failAt?: number, sink?: { promptDisposals: number[] }) {
  const tools: Array<{
    schema: { name: string }
    execute: (call: NativeToolExecution) => unknown
    output: { render: (call: NativeToolExecution, value: unknown) => unknown }
  }> = []
  const sections: Array<{ name: string; order: number; text: () => string }> = []
  const handlers = new Map<string, (agent: unknown) => void>()
  const attachHandlers: Array<(owner: { agent: unknown }) => Promise<void>> = []
  const toolDisposers: Array<() => Promise<void>> = []
  const effects: Array<() => unknown> = []
  let registrations = 0
  const promptDisposals: number[] = []
  const toolDisposals: number[] = []
  const teams = {
    tryMembership: vi.fn(() => ({ role: 'lead', name: 'lead', id: 'team-1' })),
    spawnTeammate: vi.fn(async () => ({ member: member() })),
    sendMessage: vi.fn(async () => ({ messageId: 'message-1', status: 'accepted' })),
    listMembers: vi.fn(() => [member({ id: 'lead', name: 'lead', role: 'lead' })]),
    waitForChange: vi.fn(async () => ({ timedOut: false })),
    interrupt: vi.fn(() => ({ previousStatus: 'idle' })),
    createTask: vi.fn(async () => task()),
    listTasks: vi.fn(() => [task(), task({ id: 'task-2', ownerName: 'worker' })]),
    getTask: vi.fn(() => task()),
    updateTask: vi.fn(async () => task({ revision: 2, status: 'in_progress' })),
  }
  const agent = { id: NativeAgentId('lead'), scope: {} }
  const disposers: Array<() => unknown> = []
  const context = {
    require: (key: string) => ({
      agentTeams: teams,
      agents: { onDispose: () => () => {} },
      activeSessions: {
        onAttached: (handler: (owner: { agent: unknown }) => Promise<void>) => {
          attachHandlers.push(handler)
          return () => {}
        },
        owners: () => [{ agent }],
      },
      tools: {
        registerValueTool: (tool: (typeof tools)[number]) => {
          registrations++
          if (registrations === failAt) throw new Error('registration failed')
          tools.push(tool)
          const index = tools.length
          const dispose = async () => { toolDisposals.push(index) }
          toolDisposers.push(dispose)
          return dispose
        },
      },
      promptSections: {
        register: (section: (typeof sections)[number]) => {
          sections.push(section)
          const index = sections.length
          return () => {
            promptDisposals.push(index)
            sink?.promptDisposals.push(index)
          }
        },
      },
    })[key],
    effect: (disposer: () => unknown) => { disposers.push(disposer); effects.push(disposer); return async () => {} },
    on: (name: string, handler: (agent: unknown) => void) => { handlers.set(name, handler); return () => {} },
  }
  void plugin.resolve({ freshProvider: 'fresh', forkProvider: 'fork' })(context as never)
  const call = (name: string, args: unknown): NativeToolExecution => ({
    agent, session: {} as never, callId: 'call-1' as never, name, arguments: args, signal,
  }) as unknown as NativeToolExecution
  return {
    tools, sections, teams, call, disposers, effects, handlers, attachHandlers,
    toolDisposers, promptDisposals, toolDisposals,
  }
}

describe('native Team tool configuration', () => {
  it('defaults the provider selection and rejects unknown fields', () => {
    expect(resolveNativeTeamToolsConfig(undefined)).toEqual({ freshProvider: 'spawn', forkProvider: 'fork' })
    expect(() => resolveNativeTeamToolsConfig({ extra: true })).toThrow()
    expect(() => resolveNativeTeamToolsConfig('bad')).toThrow()
  })

  it('declares the exact services and installs one policy section in the member scope', () => {
    const { sections, teams, tools } = install()
    expect(plugin).toMatchObject({
      apiVersion: 1,
      targets: ['host'],
      requires: ['agentTeams', 'agents', 'activeSessions', 'tools', 'promptSections'],
      provides: [],
    })
    expect(tools.map(tool => tool.schema.name).sort()).toEqual([
      'interrupt_agent', 'list_agents', 'send_message', 'spawn_teammate', 'team_task_create',
      'team_task_get', 'team_task_list', 'team_task_update', 'wait_agent',
    ])
    const [section] = sections
    expect(section).toMatchObject({ name: 'team:policy', order: 600 })
    expect(section?.text()).toContain('Your Team role is lead; your Team name is lead; Team id is team-1.')
    teams.tryMembership.mockReturnValue(undefined as never)
    expect(section?.text()).toBe('')
  })

  it('renders the canonical value as compact JSON', () => {
    const { tools, call } = install()
    expect(tools[0]?.output.render(call('list_agents', {}), [{ id: 'lead' }])).toEqual({
      content: [{ type: 'text', text: '[{"id":"lead"}]' }],
      isError: false,
    })
  })

  it('installs on later Agent creation once and releases every contribution', async () => {
    const { handlers, toolDisposers, disposers, toolDisposals } = install()
    const created = handlers.get('agent/created')!
    const agent = { id: NativeAgentId('lead'), scope: {} }
    created(agent)
    created(agent)
    expect(toolDisposers).toHaveLength(18)
    for (const dispose of disposers) await dispose()
    expect(toolDisposals).toHaveLength(18)
  })

  it('installs when an owner attaches and skips non-members', async () => {
    const { attachHandlers, teams, toolDisposers } = install()
    const attach = attachHandlers[0]!
    const member = { id: NativeAgentId('member'), scope: {} }
    await attach({ agent: member })
    await attach({ agent: member })
    expect(toolDisposers).toHaveLength(18)
    teams.tryMembership.mockReturnValue(undefined as never)
    await attach({ agent: { id: NativeAgentId('stranger'), scope: {} } })
    expect(toolDisposers).toHaveLength(18)
  })

  it('rolls back earlier contributions when one registration fails', () => {
    const sink = { promptDisposals: [] as number[] }
    expect(() => install(3, sink)).toThrow('registration failed')
    expect(sink.promptDisposals).toHaveLength(1)
  })
})

describe('native Team tools', () => {
  it('spawns a teammate with the selected context provider', async () => {
    const { tools, teams, call } = install()
    const spawn = tools.find(tool => tool.schema.name === 'spawn_teammate')!
    await spawn.execute(call('spawn_teammate', {
      name: 'worker', description: 'Do work', prompt: 'Start', context: 'fork',
    }))
    expect(teams.spawnTeammate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      name: 'worker', description: 'Do work', context: 'fork', provider: 'fork',
      prompt: [{ type: 'text', text: 'Start' }], signal,
    }))
    await spawn.execute(call('spawn_teammate', { name: 'other', description: 'Other', prompt: 'Go' }))
    expect(teams.spawnTeammate).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      context: 'fresh', provider: 'fresh',
    }))
  })

  it('sends a durable message and lists members', async () => {
    const { tools, teams, call } = install()
    const send = tools.find(tool => tool.schema.name === 'send_message')!
    expect(await send.execute(call('send_message', { target: 'lead', message: 'hello' })))
      .toEqual({ messageId: 'message-1', status: 'accepted' })
    expect(teams.sendMessage).toHaveBeenCalledWith(expect.anything(), {
      target: 'lead', content: [{ type: 'text', text: 'hello' }], signal,
    })
    const list = tools.find(tool => tool.schema.name === 'list_agents')!
    expect(await list.execute(call('list_agents', {}))).toEqual([member({ id: 'lead', name: 'lead', role: 'lead' })])
  })

  it('short-circuits wait_agent only when no peer can change', async () => {
    const { tools, teams, call } = install()
    const wait = tools.find(tool => tool.schema.name === 'wait_agent')!
    const lead = member({ id: 'lead', name: 'lead', role: 'lead', status: 'running' })
    teams.listMembers.mockReturnValue([lead])
    expect(await wait.execute(call('wait_agent', {}))).toMatchObject({
      timedOut: false, noProgress: { reason: 'no-active-peer' },
    })
    expect(teams.waitForChange).not.toHaveBeenCalled()

    teams.listMembers.mockReturnValue([lead, member({ status: 'provisioning' })])
    expect(await wait.execute(call('wait_agent', { timeout_ms: 20_000 }))).toEqual({ timedOut: false })
    expect(teams.waitForChange).toHaveBeenCalledWith(expect.anything(), 20_000, signal)

    teams.listMembers.mockReturnValue([lead])
    await wait.execute(call('wait_agent', { timeout_ms: 1 }))
    expect(teams.waitForChange).toHaveBeenLastCalledWith(expect.anything(), 1, signal)
  })

  it('interrupts a teammate through the Team service', async () => {
    const { tools, teams, call } = install()
    const interrupt = tools.find(tool => tool.schema.name === 'interrupt_agent')!
    expect(await interrupt.execute(call('interrupt_agent', { target: 'worker' })))
      .toEqual({ previousStatus: 'idle' })
    expect(teams.interrupt).toHaveBeenCalledWith(expect.anything(), 'worker')
  })

  it('creates shared tasks with and without optional fields', async () => {
    const { tools, teams, call } = install()
    const create = tools.find(tool => tool.schema.name === 'team_task_create')!
    await create.execute(call('team_task_create', {
      subject: 'Subject', description: 'Description', blocked_by: ['task-0'], write_scopes: ['src/'],
    }))
    expect(teams.createTask).toHaveBeenLastCalledWith(expect.anything(), {
      subject: 'Subject', description: 'Description', blockedBy: ['task-0'], writeScopes: ['src/'],
    })
    await create.execute(call('team_task_create', { subject: 'Subject', description: 'Description' }))
    expect(teams.createTask).toHaveBeenLastCalledWith(expect.anything(), {
      subject: 'Subject', description: 'Description',
    })
  })

  it('filters and paginates the shared task list', async () => {
    const { tools, teams, call } = install()
    const list = tools.find(tool => tool.schema.name === 'team_task_list')!
    expect(await list.execute(call('team_task_list', {
      status: 'pending', owner: 'worker', ready: true, cursor: 0, limit: 1,
    }))).toEqual({ tasks: [task({ id: 'task-2', ownerName: 'worker' })] })
    expect(await list.execute(call('team_task_list', { owner: 'unowned' }))).toEqual({ tasks: [task()] })
    teams.listTasks.mockReturnValue([task(), task({ id: 'task-2' })])
    expect(await list.execute(call('team_task_list', { limit: 1 }))).toEqual({
      tasks: [task()], nextCursor: 1,
    })
    expect(() => list.execute(call('team_task_list', { cursor: -1 }))).toThrow('cursor')
    expect(() => list.execute(call('team_task_list', { limit: 0 }))).toThrow('limit')
    expect(() => list.execute(call('team_task_list', { limit: 101 }))).toThrow('limit')
  })

  it('reads and compare-and-set updates one task', async () => {
    const { tools, teams, call } = install()
    const get = tools.find(tool => tool.schema.name === 'team_task_get')!
    expect(await get.execute(call('team_task_get', { task_id: 'task-1' }))).toEqual(task())
    const update = tools.find(tool => tool.schema.name === 'team_task_update')!
    await update.execute(call('team_task_update', {
      task_id: 'task-1', expected_revision: 1, action: 'edit',
      subject: 'New', description: 'New description', write_scopes: ['src/'],
    }))
    expect(teams.updateTask).toHaveBeenLastCalledWith(expect.anything(), {
      taskId: 'task-1', expectedRevision: 1, action: 'edit',
      subject: 'New', description: 'New description', writeScopes: ['src/'],
    })
    await update.execute(call('team_task_update', {
      task_id: 'task-1', expected_revision: 1, action: 'set_dependencies',
      blocked_by: ['task-0'], owner: 'worker',
    }))
    expect(teams.updateTask).toHaveBeenLastCalledWith(expect.anything(), {
      taskId: 'task-1', expectedRevision: 1, action: 'set_dependencies',
      blockedBy: ['task-0'], owner: 'worker',
    })
    await update.execute(call('team_task_update', { task_id: 'task-1', expected_revision: 2, action: 'claim' }))
    expect(teams.updateTask).toHaveBeenLastCalledWith(expect.anything(), {
      taskId: 'task-1', expectedRevision: 2, action: 'claim',
    })
  })
})
