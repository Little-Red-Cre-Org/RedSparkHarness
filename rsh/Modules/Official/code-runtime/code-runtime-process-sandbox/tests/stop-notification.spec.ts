import { PassThrough, Writable } from 'node:stream'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ProcessSandboxCodeRuntime } from '../src/index.ts'
import type { ProcessSandbox } from '@deepseek-ai/dsh-sandbox/native'
import { NativeSandboxPolicy } from '@deepseek-ai/dsh-native-sandbox-policy'
import type { SubprocessHandle, SubprocessOperations, SubprocessOutputRead } from '@deepseek-ai/dsh-subprocess/native'
import { resolveNativeWorkerThreadConfig } from '@deepseek-ai/dsh-native-code-runtime'
import type { CodeJsonValue } from '@deepseek-ai/dsh-native-code-runtime'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'

function makeSession(cwd = process.cwd(), mode?: 'read-only' | 'workspace-write' | 'danger-full-access'): Session {
  const id = SessionId('process-sandbox-code-runtime-test')
  const session = Session.create(id, undefined, {
    version: SESSION_FORMAT_VERSION, id, createdAt: 1, cwd, isSeeded: false, delegationDepth: 0,
  })
  if (mode !== undefined) session.append('sandbox/mode', { mode })
  return session
}

function runtimeFixture(stdoutText: string, exitCode: number, stderrText = '', options: { session?: Session; policy?: NativeSandboxPolicy } = {}): {
  runtime: ProcessSandboxCodeRuntime
  handle: SubprocessHandle
  session: Session
  policy: NativeSandboxPolicy
  observed: { mode?: string; workspaceRoot?: string; spawnCwd?: string }
} {
  const stdout = new PassThrough()
  stdout.end(stdoutText)
  const stdin = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  const stderrReader = {
    readFrom: (_fromByte: number): SubprocessOutputRead => ({
      text: stderrText, nextOffset: Buffer.byteLength(stderrText), lossy: false,
    }),
  }
  const handle = {
    stdin, stdout, stderr: undefined,
    collected: { stderr: stderrReader },
    done: Promise.resolve({ exitCode, signal: null }),
    terminate: vi.fn(),
    waitForExit: async () => true,
  } as unknown as SubprocessHandle
  const observed: { mode?: string; workspaceRoot?: string; spawnCwd?: string } = {}
  const subprocess = {
    spawn: (options: { cwd: string }) => { observed.spawnCwd = options.cwd; return handle },
  } as unknown as SubprocessOperations
  const sandbox = {
    confine: (argv: readonly string[], policy: { mode: string; workspaceRoot: string }) => {
      observed.mode = policy.mode
      observed.workspaceRoot = policy.workspaceRoot
      return { argv: [...argv], enforcement: 'partial', denialSignatures: [],
        runnerFailureRules: [{ fatalSignatures: ['fake-runner: unavailable'] }] }
    },
  } as ProcessSandbox
  const policy = options.policy ?? new NativeSandboxPolicy({ mode: 'workspace-write', workspaceRoot: process.cwd() })
  const currentSession = options.session ?? makeSession()
  return {
    runtime: new ProcessSandboxCodeRuntime(
      subprocess, sandbox, policy,
      resolveNativeWorkerThreadConfig({ computeMs: 1_000, maxWallMs: 5_000, maxOutputBytes: 1_024 }),
    ),
    handle,
    session: currentSession,
    policy,
    observed,
  }
}

function frame(value: object): string { return JSON.stringify(value) + '\n' }

describe('process-sandbox stop notifications', () => {
  it('suppresses pre-start child misuse and runner startup failures', async () => {
    const misuse = runtimeFixture(frame({ type: 'misuse', message: 'invalid child bindings' }), 0)
    let misuseStops = 0
    await expect(misuse.runtime.run({
      program: 'return 1', bindings: [], session: misuse.session, onStop: () => { misuseStops++ },
    })).rejects.toThrow('invalid child bindings')
    expect(misuseStops).toBe(0)
    await misuse.runtime.dispose()

    const runner = runtimeFixture('', 127, 'fake-runner: unavailable')
    let runnerStops = 0
    await expect(runner.runtime.run({
      program: 'return 1', bindings: [], session: runner.session, onStop: () => { runnerStops++ },
    })).rejects.toMatchObject({ name: 'SandboxUnavailableError' })
    expect(runnerStops).toBe(0)
    await runner.runtime.dispose()
  })

  it('notifies once after start and before a caller-owned binding settles', async () => {
    const childOutput = [
      { type: 'started' },
      { type: 'started' },
      { type: 'call', id: 1, global: 'tools', name: 'wait', args: null },
      { type: 'done', result: { logs: [], value: 'finished' } },
    ].map(frame).join('')
    const { runtime, session } = runtimeFixture(childOutput, 0)
    let bindingSettled = false
    let resolveBinding!: (value: CodeJsonValue) => void
    let bindingStartedResolve!: () => void
    const bindingStarted = new Promise<void>((resolve) => { bindingStartedResolve = resolve })
    const waitForBinding = new Promise<CodeJsonValue>((resolve) => { resolveBinding = resolve })
    let stopCalls = 0
    let unsettledAtStop = false
    let stopResolve!: () => void
    const stopped = new Promise<void>((resolve) => { stopResolve = resolve })
    const run = runtime.run({
      program: 'return await tools.wait({})',
      session,
      bindings: [{
        global: 'tools',
        functions: {
          wait: () => {
            bindingStartedResolve()
            return waitForBinding
          },
        },
      }],
      onStop: () => {
        stopCalls++
        unsettledAtStop = !bindingSettled
        stopResolve()
      },
    })

    await bindingStarted
    await stopped
    expect(stopCalls).toBe(1)
    expect(unsettledAtStop).toBe(true)
    bindingSettled = true
    resolveBinding('late')
    await expect(run).resolves.toEqual({ logs: [], value: 'finished' })
    expect(stopCalls).toBe(1)
    await runtime.dispose()
  })

  it.each([
    { sessionMode: 'read-only' as const, deploymentMode: 'workspace-write' as const },
    { sessionMode: 'workspace-write' as const, deploymentMode: 'read-only' as const },
  ])('confines with the live Session $sessionMode mode and workspace instead of installation defaults', async ({ sessionMode, deploymentMode }) => {
    const workspaceRoot = resolve('native-code-runtime-session-workspace')
    const currentSession = makeSession(workspaceRoot, sessionMode)
    const policy = new NativeSandboxPolicy({ mode: deploymentMode, workspaceRoot: process.cwd() })
    const resolvePolicy = vi.spyOn(policy, 'resolve')
    const childOutput = frame({ type: 'done', result: { logs: [], value: 1 } })
    const fixture = runtimeFixture(childOutput, 0, '', { session: currentSession, policy })

    await expect(fixture.runtime.run({ program: 'return 1', bindings: [], session: currentSession }))
      .resolves.toEqual({ logs: [], value: 1 })
    expect(resolvePolicy).toHaveBeenCalledWith({ session: currentSession })
    expect(fixture.observed).toEqual({ mode: sessionMode, workspaceRoot, spawnCwd: workspaceRoot })
    await fixture.runtime.dispose()
  })

  it('rejects a Session danger-full-access override before starting a confined process', async () => {
    const currentSession = makeSession(resolve('native-code-runtime-danger-workspace'), 'danger-full-access')
    const policy = new NativeSandboxPolicy({ mode: 'workspace-write', workspaceRoot: process.cwd() })
    const fixture = runtimeFixture(frame({ type: 'done', result: { logs: [], value: 1 } }), 0, '', { session: currentSession, policy })

    await expect(fixture.runtime.run({ program: 'return 1', bindings: [], session: currentSession }))
      .rejects.toThrow('confined policy required')
    expect(fixture.observed).toEqual({})
    await fixture.runtime.dispose()
  })
})
