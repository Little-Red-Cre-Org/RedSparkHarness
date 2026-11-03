/** Real Program composition shared by model intent and carrier tests. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { NativeSessionPersistenceOperations } from '@redspark/rsh-session-persistence/native'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brandString } from '@redspark/rsh-brand'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import { localFilesystemPlugin } from '@redspark/rsh-fs-local/native'
import { plugin as storagePlugin } from '@redspark/rsh-session-persistence-jsonl/native'
import { plugin as agentPlugin } from '@redspark/rsh-native-agent'
import { plugin as executionPlugin, type NativeRootExecutionOperations, type NativeRootRouteId, type NativeActiveSessionOperations } from '@redspark/rsh-native-session-execution'
import { plugin as modelExecutionPlugin } from '@redspark/rsh-native-model-execution/native'
import type { NativeModel } from '@redspark/rsh-native-model-execution'
import { createNativeHeadlessApplication, plugin as appPlugin } from '@redspark/rsh-native-headless/native'
import { plugin as instructionsPlugin } from '@redspark/rsh-agent-instructions/native'
import { SessionId, type SessionEvent } from '@redspark/rsh-session/native'
import { type LlmResolvedModelInfo, type ReasoningEffortId } from '@redspark/rsh-llm/native'
import { plugin } from '../src/native.ts'
import type { NativeModelSelectionOperations } from '../src/definition.ts'

export async function fixture(resolve: (provider: string, model: string, signal: AbortSignal) => Promise<LlmResolvedModelInfo> =
  async (provider, id) => ({ provider, id, name: id }), options?: {
  model?: NativeModel
  maxTokens?: number
  reasoningEffort?: ReasoningEffortId
  defaultModelSelection?: () => { provider: string; model: string; reasoningEffort?: ReasoningEffortId } | undefined
  home?: string
  preserve?: true
}) {
  const home = options?.home ?? await mkdtemp(join(tmpdir(), 'native-selection-host-'))
  const scope = new NativeScope()
  let active: NativeActiveSessionOperations | undefined
  let roots: NativeRootExecutionOperations | undefined
  let selection: NativeModelSelectionOperations | undefined
  let storage: NativeSessionPersistenceOperations | undefined
  let headless: ReturnType<typeof createNativeHeadlessApplication> | undefined
  const capture: NativePlugin = { apiVersion: 1, name: 'selection-host-capture', targets: ['host'],
    requires: ['rootExecution', 'modelSelection', 'sessionPersistence', 'activeSessions'], provides: [], resolve: () => (context) => {
      active = context.require('activeSessions')
      roots = context.require('rootExecution')
      selection = context.require('modelSelection')
      storage = context.require('sessionPersistence')
    } }
  const models: NativePlugin = { apiVersion: 1, name: 'selection-fixture-model', targets: ['host'], requires: [],
    provides: ['model', 'modelDirectory'], resolve: () => (context) => {
      context.provide('model', options?.model ?? { async *stream() { yield { type: 'finish', reason: { kind: 'stop' } } } })
      context.provide('modelDirectory', { providers: () => [{ id: 'fixture', name: 'Fixture' }], resolve,
        catalog: async defaults => ({ default: defaults, routableProviders: ['fixture'], groups: [], failures: [] }) })
    } }
  const appConfig = { cwd: home, provider: 'fixture', model: 'default', systemPrompt: 'Selection.', maxSteps: 1,
    ...options?.maxTokens === undefined ? {} : { maxTokens: options.maxTokens },
    ...options?.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort } }
  const defaultModelSelection = options?.defaultModelSelection
  const application: NativePlugin = defaultModelSelection === undefined ? appPlugin : {
    ...appPlugin,
    resolve: () => (context) => {
      const active = context.optional('activeSessions')
      if (active === undefined) throw new Error('selection fixture requires active Sessions')
      const execution = context.optional('sessionExecution')
      const app = createNativeHeadlessApplication(context, appConfig, scope, {
        active,
        ...execution === undefined ? {} : { execution },
        defaultModelSelection,
      })
      headless = app
      context.provide('application', app)
      context.provide('rootExecution', app.rootExecution)
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined }, { plugin, scope, config: undefined },
    { plugin: instructionsPlugin, scope, config: { maxBytes: 65_536, rshHome: home } },
    { plugin: application, scope, config: appConfig },
    { plugin: executionPlugin, scope, config: undefined }, { plugin: agentPlugin, scope, config: undefined },
    { plugin: modelExecutionPlugin, scope, config: undefined }, { plugin: models, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: home } },
    { plugin: storagePlugin, scope, config: { root: join(home, 'sessions'), compression: 'none' } },
  ], 'host'))
  try {
    await writeFile(join(home, 'AGENTS.md'), 'Use the selected model and preserve workspace instructions.')
    await host.start()
    if (roots === undefined || selection === undefined || storage === undefined || active === undefined) throw new Error('actual selection services missing')
    return { host, home, roots, selection, storage, active, route: brandString<NativeRootRouteId>('root'),
      ...headless === undefined ? {} : { headless },
      async close() {
        await host.stop()
        if (options?.preserve === undefined) await rm(home, { recursive: true, force: true })
      } }
  } catch (error) { await host.stop(); await rm(home, { recursive: true, force: true }); throw error }
}

export async function readEvents(
  storage: NativeSessionPersistenceOperations, id: ReturnType<typeof SessionId>,
): Promise<readonly SessionEvent[]> {
  const reader = await storage.open(id, 'read')
  try { return (await reader.read(0, 100000)).events } finally { await reader.close() }
}
