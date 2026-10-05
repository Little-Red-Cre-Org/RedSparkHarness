import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeJobOutcome, NativeJobRegistry, NativeJobStart } from '@deepseek-ai/dsh-native-jobs'
import { NativeAgentId, plugin as agentsPlugin, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { plugin as jobsPlugin } from '@deepseek-ai/dsh-native-jobs'
import { plugin as subprocessPlugin } from '@deepseek-ai/dsh-subprocess-local/native'
import { plugin as shellPlugin, resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local/native'
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
        if (controls) context.provide('jobControls', { jobs })
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

it.skipIf(spawnSync(resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true']).status !== 0)('publishes real PowerShell stdout and stderr while running and awaits cancellation', async () => {
  const scope = new NativeScope()
  let tools: NativeValueToolContribution | undefined
  let services: { agents: NativeAgentRegistry; jobs: NativeJobRegistry } | undefined
  const capture: NativePlugin = {
    apiVersion: 1, name: 'live-shell-test', targets: ['host'], requires: ['agents', 'jobs'],
    provides: ['tools', 'shellEnv', 'jobControls'],
    resolve: () => (context) => {
      services = { agents: context.require('agents'), jobs: context.require('jobs') }
      context.provide('tools', { registerValueTool(value: NativeValueToolContribution) {
        tools = value
        return () => {}
      } } as unknown as NativeToolRegistry)
      context.provide('shellEnv', { collect: () => ({}) } as unknown as ShellEnvironment<NativeToolExecution>)
      context.provide('jobControls', { jobs: context.require('jobs') })
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin, scope, config: undefined }, { plugin: capture, scope, config: undefined },
    { plugin: agentsPlugin, scope, config: undefined }, { plugin: jobsPlugin, scope, config: undefined },
    { plugin: subprocessPlugin, scope, config: undefined }, { plugin: shellPlugin, scope, config: { graceMs: 500 } },
  ], 'host'))
  let release: (() => Promise<void>) | undefined
  try {
    await host.start()
    if (services === undefined || tools === undefined) throw new Error('live shell services missing')
    const selected = services
    const agent = { id: NativeAgentId('shell-output'), scope: new NativeScope(scope) }
    release = selected.agents.register(agent)
    const result = await tools.execute({
      arguments: { command: "[Console]::Out.WriteLine('RSH_LIVE_你好'); [Console]::Error.WriteLine('RSH_ERROR'); Start-Sleep -Seconds 30",
        description: 'Produce live output', run_in_background: true },
      agent, session: { header: {} }, signal: new AbortController().signal,
    } as NativeToolExecution) as { kind: 'background'; jobId: string }
    const id = NativeJobId(result.jobId)
    await expect.poll(() => selected.jobs.read(id, agent).output, { timeout: 5000 }).toContain('RSH_ERROR')
    const live = selected.jobs.read(id, agent)
    expect(live.output).toContain('RSH_LIVE_你好')
    expect(live.output).toContain('[stderr]')
    expect(selected.jobs.get(id, agent).status).toBe('running')
    expect(selected.jobs.cancel(id, agent)).toBe('requested')
    expect((await selected.jobs.wait(id, agent, 5000)).status).toBe('cancelled')
    expect(selected.jobs.read(id, agent).output.match(/RSH_LIVE_你好/g)).toHaveLength(1)
  } finally {
    try { await release?.() } finally { await host.stop() }
  }
}, 15_000)
