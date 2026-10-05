import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeJobOutcome, NativeJobRegistry, NativeJobStart } from '@deepseek-ai/dsh-native-jobs'
import { NativeJobId } from '@deepseek-ai/dsh-native-jobs'
import type { NativeToolExecution, NativeToolRegistry, NativeValueToolContribution } from '@deepseek-ai/dsh-native-tools'
import type { ShellEnvironment } from '@deepseek-ai/dsh-shell-env/definition'
import type { ShellExecSpec, ShellOperations, ShellProcess } from '@deepseek-ai/dsh-shell/native'
import { plugin } from '../src/native.ts'

it('offers background execution only with job controls and reports a failed sandbox runner', async () => {
  for (const controls of [false, true]) {
    let contribution: NativeValueToolContribution | undefined
    let runner: NativeJobStart['run'] | undefined
    const proc: ShellProcess = {
      status: 'completed', exitCode: 1, signal: null, done: Promise.resolve(),
      sandbox: { mode: 'read-only', denied: false, runnerFailed: true },
      readOutput: () => ({ delta: 'runner failed', lossy: false }), kill: () => false,
    }
    const shell: ShellOperations = {
      sandboxMode: undefined,
      resolve: request => request as ShellExecSpec,
      run: async () => { throw new Error('foreground run was not requested') },
      start: () => proc,
    }
    const tools = { registerValueTool(value: NativeValueToolContribution) {
      contribution = value
      return () => {}
    } } as unknown as NativeToolRegistry
    const jobs = { start(spec: NativeJobStart) {
      runner = (signal, publishOutput) => spec.run(signal, publishOutput)
      return NativeJobId('pwsh-1')
    } } as NativeJobRegistry
    const shellEnv = { collect: () => ({}) } as unknown as ShellEnvironment<NativeToolExecution>
    const provider: NativePlugin = {
      apiVersion: 1, name: 'test-shell-services', targets: ['host'], requires: [],
      provides: controls ? ['shell', 'tools', 'shellEnv', 'jobs', 'jobControls'] : ['shell', 'tools', 'shellEnv', 'jobs'],
      resolve: () => (context) => {
        context.provide('shell', shell)
        context.provide('tools', tools)
        context.provide('shellEnv', shellEnv)
        context.provide('jobs', jobs)
        if (controls) context.provide('jobControls', true)
      },
    }
    const scope = new NativeScope()
    const host = new NativeHost(resolveInstallation([
      { plugin, scope, config: undefined }, { plugin: provider, scope, config: undefined },
    ], 'host'))
    await host.start()
    try {
      if (contribution === undefined) throw new Error('pwsh tool not registered')
      const call = {
        arguments: { command: 'echo test', description: 'test', run_in_background: true },
        session: { header: {} }, signal: new AbortController().signal,
      } as NativeToolExecution
      expect(JSON.stringify(contribution.schema.parameters).includes('"run_in_background"')).toBe(controls)
      if (!controls) {
        await expect(contribution.execute(call)).rejects.toThrow('background jobs are unavailable')
      } else {
        await expect(contribution.execute(call)).resolves.toEqual({ kind: 'background', jobId: 'pwsh-1' })
        if (runner === undefined) throw new Error('background runner not registered')
        const outcome: NativeJobOutcome = await runner(new AbortController().signal, () => {})
        expect(outcome.status).toBe('failed')
        expect(outcome.output).toContain('runner failed')
      }
    } finally {
      await host.stop()
    }
  }
})
