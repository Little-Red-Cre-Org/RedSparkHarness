import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { ProcessSandboxCodeRuntime } from '../src/index.ts'
import type { ProcessSandbox } from '@deepseek-ai/dsh-sandbox/native'
import type { NativeSandboxPolicy } from '@deepseek-ai/dsh-native-sandbox-policy'
import type { SubprocessHandle, SubprocessOperations, SubprocessOutputRead } from '@deepseek-ai/dsh-subprocess/native'
import { resolveNativeWorkerThreadConfig } from '@deepseek-ai/dsh-native-code-runtime'
import type { CodeJsonValue } from '@deepseek-ai/dsh-native-code-runtime'

function runtimeFixture(stdoutText: string, exitCode: number, stderrText = ''): {
  runtime: ProcessSandboxCodeRuntime
  handle: SubprocessHandle
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
  const subprocess = { spawn: () => handle } as unknown as SubprocessOperations
  const sandbox = {
    confine: (argv: readonly string[]) => ({
      argv: [...argv], enforcement: 'partial', denialSignatures: [],
      runnerFailureRules: [{ fatalSignatures: ['fake-runner: unavailable'] }],
    }),
  } as ProcessSandbox
  const policy = {
    resolve: () => ({ mode: 'read-only', workspaceRoot: process.cwd() }),
  } as unknown as NativeSandboxPolicy
  return {
    runtime: new ProcessSandboxCodeRuntime(
      subprocess, sandbox, policy,
      resolveNativeWorkerThreadConfig({ computeMs: 1_000, maxWallMs: 5_000, maxOutputBytes: 1_024 }),
    ),
    handle,
  }
}

function frame(value: object): string { return JSON.stringify(value) + '\n' }

describe('process-sandbox stop notifications', () => {
  it('suppresses pre-start child misuse and runner startup failures', async () => {
    const misuse = runtimeFixture(frame({ type: 'misuse', message: 'invalid child bindings' }), 0)
    let misuseStops = 0
    await expect(misuse.runtime.run({
      program: 'return 1', bindings: [], onStop: () => { misuseStops++ },
    })).rejects.toThrow('invalid child bindings')
    expect(misuseStops).toBe(0)
    await misuse.runtime.dispose()

    const runner = runtimeFixture('', 127, 'fake-runner: unavailable')
    let runnerStops = 0
    await expect(runner.runtime.run({
      program: 'return 1', bindings: [], onStop: () => { runnerStops++ },
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
    const { runtime } = runtimeFixture(childOutput, 0)
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
})
