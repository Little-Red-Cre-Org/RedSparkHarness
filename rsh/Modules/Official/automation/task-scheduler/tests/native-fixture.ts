/** Shared actual native Host composition for scheduled work and route lifecycle tests. */
import { mkdtemp, rm } from 'node:fs/promises'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NativeHost, NativeScope, resolveInstallation, type InstallationRequest, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm/native'
import type { LlmModelReasoningInfo } from '@deepseek-ai/dsh-llm'
import { plugin as storagePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { plugin as agentPlugin, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'

import { plugin as executionPlugin, type NativeSessionExecutionOperations, type NativeActiveSessionOperations,
  type NativeRootExecutionOperations } from '@deepseek-ai/dsh-native-session-execution'

import { plugin as modelExecutionPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import type { NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'

import { plugin as promptPlugin } from '@deepseek-ai/dsh-native-prompt/native'
import { plugin as goalsPlugin, type NativeGoalOperations, type NativeScheduledGoalHost } from '@deepseek-ai/dsh-goal/native'
import { plugin as goalDriverPlugin, type NativeGoalContinuationOperations } from '@deepseek-ai/dsh-goal-round-driver/native'
import { plugin as goalToolsPlugin } from '@deepseek-ai/dsh-tool-goal/native'
import { MockAdapter } from '../../../../../Engine/core/agent-loop/tests/mock-adapter.ts'

import { plugin as schedulePlugin } from '../src/native.ts'
import { NativeTaskSchedulerRegistry } from '../src/native-registry.ts'

import type { NativeTaskSchedulerOperations } from '../src/native-types.ts'
import { NativeHeadlessApplication, plugin as appPlugin } from '@deepseek-ai/dsh-native-headless/native'

/**
 * Start the real native Host with a scripted model Provider.
 * @param script - ordered model responses.
 * @returns live services and a draining Host teardown.
 */
export async function fixture(script: ConstructorParameters<typeof MockAdapter>[0], existingRoot?: string, builtinTools = true,
  reasoningEffort?: string, maxTokens?: number, includeGoals = false) {
  const ownsRoot = existingRoot === undefined
  const root = existingRoot ?? await mkdtemp(join(tmpdir(), 'rsh-task-scheduler-host-'))
  const scope = new NativeScope()
  const reasoning: LlmModelReasoningInfo | undefined = reasoningEffort === undefined ? undefined : {
    efforts: [{ id: ReasoningEffortId(reasoningEffort), name: reasoningEffort }],
    defaultEffort: ReasoningEffortId(reasoningEffort),
  }
  const model = new MockAdapter(script, reasoning, maxTokens)
  let app: NativeHeadlessApplication | undefined
  let storage: NativeSessionPersistenceOperations | undefined
  let agents: NativeAgentRegistry | undefined
  let execution: NativeSessionExecutionOperations | undefined
  let tools: NativeToolRegistry | undefined
  let activeSessions: NativeActiveSessionOperations | undefined
  let rootExecution: NativeRootExecutionOperations | undefined
  let goals: NativeGoalOperations | undefined
  let goalContinuation: NativeGoalContinuationOperations | undefined
  let scheduledGoalHost: NativeScheduledGoalHost | undefined
  let schedules: NativeTaskSchedulerOperations | undefined
  let scheduler: NativeTaskSchedulerRegistry | undefined
  const capture: NativePlugin = { apiVersion: 1, name: 'schedule-capture', targets: ['host'],
    requires: ['application', 'sessionPersistence', 'agents', 'sessionExecution', 'tools', 'activeSessions', 'rootExecution', 'taskScheduler'],
    optional: ['goals', 'goalContinuation', 'scheduledGoalHost'], provides: [],
    resolve: () => (context) => {
      const application = context.require('application')
      if (!(application instanceof NativeHeadlessApplication)) throw new Error('missing native headless')
      app = application
      storage = context.require('sessionPersistence')
      agents = context.require('agents')
      execution = context.require('sessionExecution')
      tools = context.require('tools')
      activeSessions = context.require('activeSessions')
      rootExecution = context.require('rootExecution')
      goals = context.optional('goals')
      goalContinuation = context.optional('goalContinuation')
      scheduledGoalHost = context.optional('scheduledGoalHost')
      schedules = context.require('taskScheduler')
      if (schedules instanceof NativeTaskSchedulerRegistry) scheduler = schedules
    } }
  const modelProvider: NativePlugin = { apiVersion: 1, name: 'schedule-model', targets: ['host'],
    requires: [], provides: ['model'], resolve: () => (context) => { context.provide('model', model) } }
  let schedulerConfig = { path: join(root, 'tasks.sqlite'), pollMs: 100, runTimeoutMs: 1000 }
  let schedulerRequest: InstallationRequest = { plugin: schedulePlugin, scope, config: schedulerConfig }
  let requests: InstallationRequest[] = [
    { plugin: capture, scope, config: undefined },
    { plugin: appPlugin, scope, config: { cwd: root, provider: 'mock', model: 'parent', systemPrompt: 'Parent.', maxSteps: 4,
      builtinTools, ...reasoningEffort === undefined ? {} : { reasoningEffort }, ...maxTokens === undefined ? {} : { maxTokens } } },
    { plugin: executionPlugin, scope, config: undefined },
    { plugin: agentPlugin, scope, config: undefined },
    { plugin: toolsPlugin, scope, config: undefined },
    ...(includeGoals ? [
      { plugin: goalsPlugin, scope, config: undefined },
      { plugin: goalDriverPlugin, scope, config: undefined },
      { plugin: goalToolsPlugin, scope, config: undefined },
    ] : []),
    schedulerRequest,
    { plugin: promptPlugin, scope, config: undefined },
    { plugin: modelExecutionPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: root } },
    { plugin: storagePlugin, scope, config: { root: join(root, 'sessions'), compression: 'none' } },
    { plugin: modelProvider, scope, config: undefined },
  ]
  const host = new NativeHost(resolveInstallation(requests, 'host'))
  try { await host.start() }
  catch (failure: unknown) {
    await host.stop()
    if (ownsRoot) await rm(root, { recursive: true, force: true })
    throw failure
  }
  if (app === undefined || storage === undefined || agents === undefined || execution === undefined || tools === undefined
    || rootExecution === undefined || activeSessions === undefined || schedules === undefined || scheduler === undefined) {
    throw new Error('missing continuation fixture services')
  }
  return { root, host, scope, model, app, storage, agents, execution, tools, activeSessions, rootExecution,
    get goals() { return goals }, get goalContinuation() { return goalContinuation }, get scheduledGoalHost() { return scheduledGoalHost },
    get schedules() { return schedules! }, get scheduler() { return scheduler! },
    async replaceScheduler(pollMs: number) {
      const nextConfig = { ...schedulerConfig, pollMs }
      const nextRequest: InstallationRequest = { ...schedulerRequest, config: nextConfig }
      const nextRequests = requests.map(request => request === schedulerRequest ? nextRequest : request)
      await host.replace(resolveInstallation(nextRequests, 'host'))
      schedulerConfig = nextConfig
      schedulerRequest = nextRequest
      requests = nextRequests
    },
    async dispose() { await host.stop() },
    async close() { await host.stop(); if (ownsRoot) await rm(root, { recursive: true }) } }
}
