/**
 * The Native Claude Code bridge answers the Native extension points with the same
 * decisions its Cordis counterpart answers the compatibility points with.
 *
 * Each case composes the real bridge plugin over a Native scope, writes a real
 * hooks.json, and drives the tool interception service. The shell service is a
 * stub answering fixed command text, so the bridge code under test is the
 * shipped one and no process is spawned.
 *
 * @module tests/native
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NativeScope } from '@redspark/rsh-native-runtime'
import { NativeAgentId, NativeAgentRegistry } from '@redspark/rsh-native-agent'
import { ToolCallId } from '@redspark/rsh-llm/native'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@redspark/rsh-session/native'
import { NativeToolRegistry, type NativeToolExecution } from '@redspark/rsh-native-tools'
import type { ShellOperations } from '@redspark/rsh-shell/native'
import { plugin } from '../src/native.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/**
 * Write a hooks.json into a fresh temp dir.
 * @param hooks - the hooks map the config file carries.
 * @returns the config file path.
 */
function writeConfig(hooks: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'native-hooks-'))
  dirs.push(dir)
  const path = join(dir, 'hooks.json')
  writeFileSync(path, JSON.stringify({ hooks }))
  return path
}

/** One stubbed hook outcome keyed by command text. */
interface Answer { readonly code?: number; readonly stdout?: string; readonly stderr?: string }

/**
 * A shell service answering from a fixed table instead of running a process.
 * @param answers - command text to its exit code, stdout and stderr.
 * @returns the minimal shell capability the hook runner consumes.
 */
function stubShell(answers: Record<string, Answer>): ShellOperations {
  return {
    sandboxMode: undefined,
    resolve: request => request as never,
    async run(spec) {
      const answer = answers[spec.command] ?? {}
      const out = (text: string) => ({ text, truncated: false })
      return {
        exitCode: answer.code ?? 0, signal: null, timedOut: false, aborted: false, timeoutMs: 0,
        stdout: out(answer.stdout ?? ''), stderr: out(answer.stderr ?? ''),
      }
    },
    start() { throw new Error('the bridge never starts a hook in the background') },
  }
}

/** One Native Agent, Session and tool registry the bridge installs over. */
function fixture(configPath: string, shell: ShellOperations) {
  const scope = new NativeScope()
  const agents = new NativeAgentRegistry({ emit() {} })
  const agent = { id: NativeAgentId('hook-owner'), scope }
  agents.register(agent)
  const tools = new NativeToolRegistry(agents, scope)
  const id = SessionId('hook-session')
  const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false, cwd: '/' })
  const call = (name: string): NativeToolExecution => ({
    agent, session, name, callId: ToolCallId(`call-${name}`), arguments: {},
    signal: new AbortController().signal, turn: 1,
    appendEvent: async (type, data, ...opts) => session.append(type, data, ...opts),
  })
  return { scope, tools, session, call, configPath, shell }
}

/** Install the bridge over a fixture and return its disposer. */
async function installBridge(
  state: ReturnType<typeof fixture>,
  scope: NativeScope, shell: ShellOperations, tools: NativeToolRegistry,
): Promise<() => Promise<void>> {
  const disposers: (() => Promise<void> | void)[] = []
  const resolved = plugin.resolve({ configPath: state.configPath }) as (context: unknown) => void
  resolved({
    scope,
    signal: new AbortController().signal,
    require: (key: string) => { if (key !== 'shell') throw new Error(`unexpected capability ${key}`); return shell },
    optional: (key: string) => (key === 'tools' ? tools : undefined),
    own: (dispose: () => Promise<void> | void) => { disposers.push(dispose); return async () => { await dispose() } },
    effect: (dispose: () => Promise<void> | void) => { disposers.push(dispose); return async () => { await dispose() } },
    on: () => async () => {},
    provide: () => {},
  })
  return async () => { for (const dispose of disposers.reverse()) await dispose() }
}

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: false })
const schema = (name: string) => ({ name, description: name, parameters: { type: 'object' as const, properties: {} } })

describe('Native Claude Code bridge', () => {
  it('denies a matched tool before its body runs and records the pair', async () => {
    const configPath = writeConfig({
      PreToolUse: [{ matcher: 'bash', hooks: [{ type: 'command', command: 'deny.sh' }] }],
    })
    const shell = stubShell({ 'deny.sh': { code: 2, stderr: 'bash is disabled by policy in this session' } })
    const state = fixture(configPath, shell)
    const dispose = await installBridge(state, state.scope, shell, state.tools)
    let bodyRan = false
    state.tools.register({ schema: schema('bash'), execute: async () => { bodyRan = true; return ok('never') } })
    await expect(state.tools.execute(state.call('bash'))).rejects.toThrow('bash is disabled by policy in this session')
    expect(bodyRan).toBe(false)
    const accepted = state.session.snapshotEvents()
    expect(accepted.filter(event => event.type === 'hook/invoked'))
      .toMatchObject([{ data: { point: 'PreToolUse', dialect: 'claude-code', matcher: 'bash', turn: 1 } }])
    expect(accepted.filter(event => event.type === 'hook/result'))
      .toMatchObject([{ data: { point: 'PreToolUse', decision: 'block', exitCode: 2 } }])
    await dispose()
  })

  it('leaves an unmatched tool to its body', async () => {
    const configPath = writeConfig({
      PreToolUse: [{ matcher: 'bash', hooks: [{ type: 'command', command: 'deny.sh' }] }],
    })
    const shell = stubShell({ 'deny.sh': { code: 2, stderr: 'no' } })
    const state = fixture(configPath, shell)
    const dispose = await installBridge(state, state.scope, shell, state.tools)
    state.tools.register({ schema: schema('read_file'), execute: async () => ok('read') })
    expect(await state.tools.execute(state.call('read_file'))).toMatchObject({ isError: false })
    expect(state.session.snapshotEvents().filter(event => event.type === 'hook/invoked')).toEqual([])
    await dispose()
  })

  it('blocks a tool result into corrective feedback', async () => {
    const configPath = writeConfig({
      PostToolUse: [{ matcher: 'bash', hooks: [{ type: 'command', command: 'block.sh' }] }],
    })
    const shell = stubShell({ 'block.sh': { code: 2, stderr: 'tool output rejected by policy: retry once' } })
    const state = fixture(configPath, shell)
    const dispose = await installBridge(state, state.scope, shell, state.tools)
    state.tools.register({ schema: schema('bash'), execute: async () => ok('HELLO') })
    const result = await state.tools.execute(state.call('bash'))
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'tool output rejected by policy: retry once' }])
    await dispose()
  })

  it('attaches hook context to a passed result', async () => {
    const configPath = writeConfig({
      PostToolUse: [{ matcher: 'bash', hooks: [{ type: 'command', command: 'note.sh' }] }],
    })
    const note = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'seen by hook' } })
    const shell = stubShell({ 'note.sh': { stdout: note } })
    const state = fixture(configPath, shell)
    const dispose = await installBridge(state, state.scope, shell, state.tools)
    state.tools.register({ schema: schema('bash'), execute: async () => ok('HELLO') })
    const result = await state.tools.execute(state.call('bash'))
    expect(result.isError).toBe(false)
    expect(result.additionalContexts).toMatchObject([{ content: [{ type: 'text', text: 'seen by hook' }] }])
    await dispose()
  })

  it('asks the application when a hook requires approval, and denies on refusal', async () => {
    const configPath = writeConfig({
      PreToolUse: [{ matcher: 'bash', hooks: [{ type: 'command', command: 'ask.sh' }] }],
    })
    const ask = JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'needs a human' },
    })
    const shell = stubShell({ 'ask.sh': { stdout: ask } })
    const state = fixture(configPath, shell)
    const dispose = await installBridge(state, state.scope, shell, state.tools)
    state.tools.register({ schema: schema('bash'), execute: async () => ok('body') })
    const refused = { ...state.call('bash'), requestApproval: async () => 'rejected' as const }
    await expect(state.tools.execute(refused)).rejects.toThrow('the user rejected tool "bash"')
    const granted = { ...state.call('bash'), requestApproval: async () => 'allowed-once' as const }
    expect(await state.tools.execute(granted)).toMatchObject({ isError: false })
    await dispose()
  })

  it('fails loud on unknown configuration and registers nothing without a config file', () => {
    expect(() => plugin.resolve({ configPath: 'x.json', nope: true }))
      .toThrow('hooks-claude-code: unknown configuration field nope')
    expect(() => plugin.resolve({})).toThrow('hooks-claude-code: configPath must be a non-empty string')
    expect(() => plugin.resolve({ configPath: 'x.json', stderrSummaryMaxChars: 0 }))
      .toThrow('hooks-claude-code: stderrSummaryMaxChars must be a positive integer')
    // A missing config file warns and registers no hooks instead of failing activation.
    expect(plugin.resolve({ configPath: join(tmpdir(), 'absent-hooks.json') })).toBeTypeOf('function')
  })
})
