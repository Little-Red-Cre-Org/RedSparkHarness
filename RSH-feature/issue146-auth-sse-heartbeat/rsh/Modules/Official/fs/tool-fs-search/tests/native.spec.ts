/** Search registration disposal cancels and drains its accepted process before returning. */
import { mkdtempSync, rmSync, realpathSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentId, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import type { NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { ToolCallId } from '@deepseek-ai/dsh-llm/native'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess/native'
import { LocalSubprocessController } from '@deepseek-ai/dsh-subprocess-local/src/controller.ts'
import { plugin as spillPlugin } from '@deepseek-ai/dsh-spill-local/native'
import type { SpillOperations } from '@deepseek-ai/dsh-spill/native'
import { plugin } from '../src/native.ts'

it('removing the native search installation joins its cancelled subprocess and removes both tools', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rsh-native-search-test-'))
  const scope = new NativeScope()
  let store!: SpillOperations
  const started = Promise.withResolvers<SubprocessHandle>()
  let agents!: NativeAgentRegistry
  let tools!: NativeToolRegistry
  const processes: NativePlugin = {
    apiVersion: 1, name: 'search-process-fixture', targets: ['host'], requires: [], provides: ['subprocess'],
    resolve: () => (context) => {
      const controller = new LocalSubprocessController(() => {})
      const spawn = controller.spawn.bind(controller)
      controller.spawn = (spec) => {
        const handle = spawn({ ...spec, argv: spec.argv.includes('--files') ? [process.execPath, '-e', 'setTimeout(() => {}, 60000)'] : spec.argv })
        if (spec.argv.includes('--files')) started.resolve(handle)
        return handle
      }
      context.own(() => controller.dispose())
      context.provide('subprocess', controller)
    },
  }
  const capture: NativePlugin = {
    apiVersion: 1, name: 'search-consumer-fixture', targets: ['host'], requires: ['tools', 'agents', 'spillStore'], provides: [],
    resolve: () => (context) => {
      agents = context.require('agents'); tools = context.require('tools'); store = context.require('spillStore')
    },
  }
  const search = { plugin, scope, config: { sampleOverCapGlobResults: false, graceMs: 100 } }
  const host = new NativeHost(resolveInstallation([
    search, { plugin: spillPlugin, scope, config: { root: home, cleanupPeriodDays: 0 } },
    { plugin: processes, scope, config: undefined }, { plugin: toolsPlugin, scope, config: undefined },
    { plugin: agentPlugin, scope, config: undefined }, { plugin: capture, scope, config: undefined },
  ], 'host'))
  await host.start()
  const agent = { id: NativeAgentId('search-owner'), scope }
  const release = agents.register(agent)
  const id = SessionId('native-search-cancellation')
  const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false, cwd: process.cwd() })
  try {
    const signal = new AbortController().signal
    const saved = await store.saveText({ owner: { sessionId: id }, source: { kind: 'tool', toolName: 'grep',
      callId: ToolCallId('full-result'), label: 'result' }, suggestedName: 'grep-results.txt', content: 'first\nsecond\n' }, signal)
    const recovered = await tools.execute({ agent, session, callId: ToolCallId('recover'), name: 'grep',
      arguments: { pattern: 'second', path: saved.locator }, signal,
      appendEvent: async (type, data, ...opts) => session.append(type, data, ...opts),
    })
    expect(recovered.isError).toBe(false)
    expect(JSON.stringify(recovered.content)).toContain('Line 2: second')
    const execution = tools.execute({ agent, session, callId: ToolCallId('search-cancel'), name: 'glob',
      arguments: { pattern: '*.ts' }, signal: new AbortController().signal,
      appendEvent: async (type, data, ...opts) => session.append(type, data, ...opts),
    })
    const rejected = expect(execution).rejects.toMatchObject({ name: 'SearchError' })
    const handle = await started.promise
    await host.remove(search)
    await rejected
    expect(await handle.waitForExit()).toBe(true)
    expect(tools.schemas(scope)).toEqual([])
  } finally {
    await release(); await host.stop()
    if (!lstatSync(home).isDirectory() || lstatSync(home).isSymbolicLink()
      || dirname(realpathSync(home)) !== realpathSync(tmpdir()) || !basename(home).startsWith('rsh-native-search-test-')) {
      throw new Error('unsafe native search test cleanup root')
    }
    rmSync(home, { recursive: true, force: true })
  }
})
