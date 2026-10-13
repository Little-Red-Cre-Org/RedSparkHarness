/** Native ACP process driver for the fixed, same-version CLI child profile. */

import { client, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type {
  ClientConnection,
  ContentBlock as AcpContentBlock,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SessionConfigOption,
} from '@agentclientprotocol/sdk'
import { Readable, Writable } from 'node:stream'
import { credentialRef } from '@deepseek-ai/dsh-credentials/native'
import type { NativeContext, NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/native'
import type { NativeExternalSubagentDriver, NativeExternalSubagentOutcome,
  NativeExternalSubagentRun, NativeSubagentStopReason } from '@deepseek-ai/dsh-native-subagent/native'
import {
  NATIVE_ACP_SUBAGENT_PROTOCOL_VERSION,
  nativeAcpSubagentPolicyMetadata,
  readNativeAcpSubagentPermissionRequest,
  readNativeAcpSubagentPolicy,
  readNativeAcpSubagentServerCapabilities,
} from '@deepseek-ai/dsh-acp-protocol'
import type { NativeAcpSubagentPermissionMode, NativeAcpSubagentPolicy } from '@deepseek-ai/dsh-acp-protocol'
import type { StoredImageAttachment } from '@deepseek-ai/dsh-attachment/native'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm/native'
import type { NativeAcpChildRuntime, NativeAcpChildRuntimeRequest } from './runtime.ts'

export type { NativeAcpChildRuntime, NativeAcpChildRuntimeLauncher, NativeAcpChildRuntimeRequest } from './runtime.ts'

interface Config {
  readonly providerName: string
  readonly providers: Readonly<Record<string, unknown>>
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`dsh-acp-child ${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function nonempty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`dsh-acp-child ${field} must be a nonempty trimmed string`)
  }
  return value
}

function resolveConfig(input: unknown): Config {
  const fields = record(input, 'configuration')
  if (Object.keys(fields).some(field => field !== 'providerName' && field !== 'providers')) {
    throw new TypeError('dsh-acp-child configuration accepts only providerName and providers')
  }
  const providers = fields.providers === undefined ? {} : record(fields.providers, 'providers')
  return { providerName: nonempty(fields.providerName, 'providerName'), providers: Object.freeze({ ...providers }) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Preserve the exact AbortSignal cancellation reason.
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort)
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Preserve the exact AbortSignal cancellation reason.
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Preserve the original work rejection reason.
        reject(error)
      },
    )
  })
}

function flattenValues(options: Extract<SessionConfigOption, { type: 'select' }>['options']): readonly string[] {
  const values: string[] = []
  for (const item of options) {
    if ('value' in item) values.push(item.value)
    else for (const option of item.options) values.push(option.value)
  }
  return values
}

function exactSelect(options: readonly SessionConfigOption[] | null | undefined, id: string): Extract<SessionConfigOption, { type: 'select' }> {
  const matches = options?.filter(option => option.id === id) ?? []
  const option = matches[0]
  if (matches.length !== 1 || option?.type !== 'select') {
    throw new Error(`dsh-acp-child child does not expose one selectable ${id} option`)
  }
  return option
}

async function selectExactRoute(
  connection: ClientConnection,
  sessionId: string,
  initial: readonly SessionConfigOption[] | null | undefined,
  provider: string,
  model: string,
  reasoningEffort?: ReasoningEffortId,
  trackRequest?: <T>(work: Promise<T>) => Promise<T>,
  signal?: AbortSignal,
): Promise<void> {
  const routeValue = JSON.stringify([provider, model])
  let options = initial
  let modelOption = exactSelect(options, 'model')
  if (!flattenValues(modelOption.options).includes(routeValue)) {
    throw new Error(`dsh-acp-child child does not advertise the exact model route ${routeValue}`)
  }
  if (modelOption.currentValue !== routeValue) {
    const selectedWork = connection.agent.request(methods.agent.session.setConfigOption, {
      sessionId, configId: 'model', value: routeValue,
    })
    const selected = await (signal === undefined ? selectedWork : raceAbort(trackRequest?.(selectedWork) ?? selectedWork, signal))
    options = selected.configOptions
    modelOption = exactSelect(options, 'model')
  }
  if (modelOption.currentValue !== routeValue) {
    throw new Error('dsh-acp-child child did not retain the selected child model route')
  }
  if (reasoningEffort !== undefined) {
    const effort = String(reasoningEffort)
    let reasoningOption = exactSelect(options, 'reasoning_effort')
    if (!flattenValues(reasoningOption.options).includes(effort)) {
      throw new Error(`dsh-acp-child child does not advertise the exact reasoning effort ${effort}`)
    }
    if (reasoningOption.currentValue !== effort) {
      const selectedWork = connection.agent.request(methods.agent.session.setConfigOption, {
        sessionId, configId: 'reasoning_effort', value: effort,
      })
      const selected = await (signal === undefined ? selectedWork : raceAbort(trackRequest?.(selectedWork) ?? selectedWork, signal))
      options = selected.configOptions
      reasoningOption = exactSelect(options, 'reasoning_effort')
    }
    if (reasoningOption.currentValue !== effort) {
      throw new Error('dsh-acp-child child did not retain the selected child reasoning effort')
    }
  }
}

async function promptContent(context: NativeContext, blocks: readonly ContentBlock[], signal: AbortSignal): Promise<AcpContentBlock[]> {
  const output: AcpContentBlock[] = []
  for (const block of blocks) {
    signal.throwIfAborted()
    if (block.type === 'text') {
      output.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      const attachments = context.optional('attachments')
      if (attachments === undefined) throw new Error('dsh-acp-child needs attachments to transfer image prompts')
      const stored: StoredImageAttachment = await attachments.readImage(block.attachment, signal)
      output.push({ type: 'image', data: Buffer.from(stored.data).toString('base64'), mimeType: stored.ref.mediaType })
    } else {
      throw new Error(`dsh-acp-child does not support prompt block "${block.type}"`)
    }
  }
  return output
}

function stopReason(response: PromptResponse, signal: AbortSignal): NativeSubagentStopReason {
  if (signal.aborted || response.stopReason === 'cancelled') return 'aborted'
  switch (response.stopReason) {
    case 'end_turn': return 'completed'
    case 'max_tokens': return 'max-tokens'
    case 'refusal': return 'refusal'
    case 'max_turn_requests': return 'error'
  }
}

function acceptedPolicy(
  meta: unknown,
  requested: NativeAcpSubagentPolicy,
): NativeAcpSubagentPolicy {
  const policy = readNativeAcpSubagentPolicy(meta)
  if (policy === undefined || policy.permissionMode !== requested.permissionMode
    || policy.maxSteps > requested.maxSteps
    || requested.maxTokens !== undefined && (policy.maxTokens === undefined || policy.maxTokens > requested.maxTokens)) {
    throw new Error('dsh-acp-child child did not acknowledge a policy within the requested limits')
  }
  return policy
}

function exactPermissionChoice(kind: 'allow_once' | 'reject_once', available: RequestPermissionRequest['options']):
RequestPermissionRequest['options'][number] | undefined {
  const ids = new Set<string>()
  for (const option of available) {
    if (ids.has(option.optionId)) return undefined
    ids.add(option.optionId)
  }
  if (available.some(option => option.kind === 'allow_always')) return undefined
  const matches = available.filter(option => option.kind === kind)
  return matches.length === 1 ? matches[0] : undefined
}

function selectedPermission(kind: 'allow_once' | 'reject_once', available: RequestPermissionRequest['options']): RequestPermissionResponse {
  const choice = exactPermissionChoice(kind, available)
  if (choice !== undefined) {
    return { outcome: { outcome: 'selected', optionId: choice.optionId } }
  }
  return { outcome: { outcome: 'cancelled' } }
}

function startDriver(context: NativeContext, config: Config): NativeExternalSubagentDriver & { dispose(): Promise<void> } {
  const lifetime = new AbortController()
  const starting = new Set<{ readonly settled: Promise<void>; close?: () => Promise<void> }>()
  const active = new Set<() => Promise<void>>()
  let closed = false
  let closing: Promise<void> | undefined

  async function dispose(): Promise<void> {
    if (closing !== undefined) return closing
    closed = true
    lifetime.abort(new Error('dsh-acp-child is closing'))
    const starts = [...starting]
    closing = (async () => {
      const errors: unknown[] = []
      const startupResults = await Promise.allSettled(starts.map(start => start.close?.() ?? Promise.resolve()))
      await Promise.all(starts.map(start => start.settled))
      const runResults = await Promise.allSettled([...active].map(stop => stop()))
      for (const result of [...startupResults, ...runResults]) {
        if (result.status === 'rejected') errors.push(result.reason)
      }
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, 'dsh-acp-child cleanup failed')
    })()
    return closing
  }

  const driver: NativeExternalSubagentDriver & { dispose(): Promise<void> } = {
    name: config.providerName,
    routeFields: ['provider', 'model', 'reasoningEffort'],
    capabilities: { persona: false, toolFilter: true, outputSchema: false, approvalRelay: true },
    dispose,
    async start(request, signal): Promise<NativeExternalSubagentRun> {
      if (closed) throw new Error('dsh-acp-child is closing')
      const operation = Promise.withResolvers<void>()
      const startup = { settled: operation.promise } as { settled: Promise<void>; close?: () => Promise<void> }
      starting.add(startup)
      const aborter = new AbortController()
      const runSignal = AbortSignal.any([signal, context.signal, lifetime.signal, aborter.signal])
      let runtime: NativeAcpChildRuntime | undefined
      let connection: ClientConnection | undefined
      let sessionId: string | undefined
      let cleanupTask: Promise<void> | undefined
      let promptStarted = false
      let promptSettled = false
      let protocolFailure: Error | undefined
      let stderrFailure: Error | undefined
      let stderrDrain: Promise<void> | undefined
      let sessionCreationPending = false
      const pendingSessionUpdates: SessionNotification[] = []
      let nativeSessionId: string | undefined
      let negotiatedPermissionMode: NativeAcpSubagentPermissionMode = 'deny'
      const seenToolCalls = new Set<string>()
      const usedToolCalls = new Set<string>()
      const seenApprovalIds = new Set<string>()
      const assistantText: string[] = []
      const remoteWork = new Set<Promise<unknown>>()
      const permissionWork = new Set<Promise<unknown>>()
      const track = <T>(work: Promise<T>): Promise<T> => {
        remoteWork.add(work)
        void work.then(() => remoteWork.delete(work), () => remoteWork.delete(work))
        return work
      }
      const failProtocol = (message: string): void => {
        protocolFailure ??= new Error(message)
        if (!aborter.signal.aborted) aborter.abort(protocolFailure)
      }
      const receiveSessionUpdate = (params: SessionNotification): void => {
        if (sessionId === undefined || params.sessionId !== sessionId) {
          failProtocol('dsh-acp-child received an update for an unknown ACP Session')
          return
        }
        const update = params.update
        if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
          assistantText.push(update.content.text)
        } else if (update.sessionUpdate === 'tool_call') {
          seenToolCalls.add(update.toolCallId)
        }
      }
      let onAbort = (): void => {}
      const closeRun = (cancel: boolean): Promise<void> => {
        if (cleanupTask !== undefined) return cleanupTask
        const cleanup = Promise.withResolvers<void>()
        cleanupTask = cleanup.promise
        if (cancel && !promptSettled && !aborter.signal.aborted) aborter.abort(new Error('dsh-acp-child run is closing'))
        void (async () => {
          const errors: unknown[] = []
          if (cancel && promptStarted && sessionId !== undefined && connection !== undefined) {
            try {
              void track(connection.agent.notify(methods.agent.session.cancel, { sessionId }))
            } catch (error) { errors.push(error) }
          }
          if (runtime !== undefined) {
            let shutdownSettled = false
            try { await runtime.shutdown(); shutdownSettled = true } catch (error) { errors.push(error) }
            if (shutdownSettled && stderrDrain !== undefined) {
              try { await stderrDrain } catch (error) { errors.push(stderrFailure ?? error) }
            }
          }
          try { connection?.close(new Error('dsh-acp-child process range closed')) } catch (error) { errors.push(error) }
          if (runtime !== undefined) {
            try { await runtime.dispose() } catch (error) { errors.push(error) }
          }
          await Promise.allSettled([...remoteWork, ...permissionWork])
          active.delete(stopRun)
          runSignal.removeEventListener('abort', onAbort)
          if (errors.length === 1) throw errors[0]
          if (errors.length > 1) throw new AggregateError(errors, 'dsh-acp-child process cleanup failed')
        })().then(cleanup.resolve, cleanup.reject)
        return cleanupTask
      }
      const stopRun = (): Promise<void> => closeRun(true)
      startup.close = async (): Promise<void> => {
        if (!aborter.signal.aborted) aborter.abort(new Error('dsh-acp-child startup is closing'))
        if (runtime !== undefined) await closeRun(true)
      }
      onAbort = (): void => { void closeRun(true).catch((error: unknown) => { protocolFailure ??= new Error(errorMessage(error)) }) }

      const app = client({ name: '@deepseek-ai/dsh-acp-child' })
        .onRequest(methods.client.session.requestPermission, async ({ params }) => {
          const work = (async (): Promise<RequestPermissionResponse> => {
            const permission = readNativeAcpSubagentPermissionRequest(params._meta)
            const reject = (): RequestPermissionResponse => selectedPermission('reject_once', params.options)
            if (runSignal.aborted) return { outcome: { outcome: 'cancelled' } }
            if (permission === undefined || sessionId === undefined || params.sessionId !== sessionId
              || permission.toolCallId !== params.toolCall.toolCallId || permission.toolName !== 'write_file'
              || !seenToolCalls.has(permission.toolCallId) || usedToolCalls.has(permission.toolCallId)
              || seenApprovalIds.has(permission.requestId) || nativeSessionId !== undefined && nativeSessionId !== permission.sessionId) {
              failProtocol('dsh-acp-child received a permission request without exact child and tool identity')
              return { outcome: { outcome: 'cancelled' } }
            }
            if (negotiatedPermissionMode !== 'parent-relay' || request.approval === undefined) {
              failProtocol('dsh-acp-child received a write permission request without parent-relay authority')
              return reject()
            }
            if (!exactPermissionChoice('allow_once', params.options)
              || !exactPermissionChoice('reject_once', params.options)) {
              failProtocol('dsh-acp-child child offered no exact one-shot permission choices')
              return { outcome: { outcome: 'cancelled' } }
            }
            usedToolCalls.add(permission.toolCallId)
            seenApprovalIds.add(permission.requestId)
            nativeSessionId ??= permission.sessionId
            let outcome: Awaited<ReturnType<NonNullable<typeof request.approval>['request']>>
            try {
              outcome = await request.approval.request({
                operationId: request.id,
                requestId: permission.requestId,
                toolName: 'write_file',
                callId: permission.toolCallId,
                signal: runSignal,
              })
            } catch (error) {
              failProtocol(`dsh-acp-child parent approval failed: ${errorMessage(error)}`)
              return { outcome: { outcome: 'cancelled' } }
            }
            // oxlint-disable-next-line typescript/no-unnecessary-condition -- The signal can abort while parent approval is pending.
            if (runSignal.aborted || outcome === 'cancelled') return { outcome: { outcome: 'cancelled' } }
            if (outcome === 'allowed-once') return selectedPermission('allow_once', params.options)
            return reject()
          })()
          permissionWork.add(work)
          void work.then(() => permissionWork.delete(work), () => permissionWork.delete(work))
          return work
        })
        .onNotification(methods.client.session.update, ({ params }) => {
          if (sessionId === undefined) {
            if (sessionCreationPending) {
              pendingSessionUpdates.push(params)
              return
            }
            failProtocol('dsh-acp-child received an update before child Session creation')
            return
          }
          receiveSessionUpdate(params)
        })

      try {
        runSignal.throwIfAborted()
        const content = await promptContent(context, request.prompt, runSignal)
        const parentPolicy = request.authority.sandboxPolicy
        if (parentPolicy === undefined) throw new Error('dsh-acp-child requires the exact parent Session sandbox policy')
        if (parentPolicy.sessionId !== undefined && parentPolicy.sessionId !== request.parentSessionId) {
          throw new Error('dsh-acp-child received sandbox authority for a different parent Session')
        }
        const profile = config.providers[request.route.provider]
        if (!isRecord(profile)) throw new Error(`dsh-acp-child has no provider profile for route "${request.route.provider}"`)
        if (Object.hasOwn(profile, 'apiKey') || Object.hasOwn(profile, 'headers')) {
          throw new Error('dsh-acp-child provider profiles cannot carry API keys or custom headers')
        }
        const apiKeyEnv = nonempty(profile.apiKeyEnv, `providers.${request.route.provider}.apiKeyEnv`)
        const selectedCredential = await context.require('credentials').resolve(credentialRef(apiKeyEnv))
        if (selectedCredential === undefined || selectedCredential.value.length === 0) {
          throw new Error(`dsh-acp-child has no credential for provider route "${request.route.provider}"`)
        }
        runSignal.throwIfAborted()

        const filterAllows = (name: string): boolean => (request.toolFilter?.allow === undefined
          || request.toolFilter.allow.includes(name)) && !request.toolFilter?.deny?.includes(name)
        const candidates = request.authority.builtinToolNames.filter((name): name is 'read_file' | 'write_file' =>
          (name === 'read_file' || name === 'write_file') && filterAllows(name))
        const canRelay = candidates.includes('write_file') && request.approval !== undefined
          && request.approval.operationId === request.id && request.authority.approvalRequired
          && parentPolicy.mode === 'workspace-write'
        const builtinTools = Object.freeze(candidates.filter(name => name !== 'write_file' || canRelay))
        const allowedTools = builtinTools
        const permissionMode: NativeAcpSubagentPermissionMode = canRelay ? 'parent-relay' : 'deny'
        const launchRequest: NativeAcpChildRuntimeRequest = {
          parentSessionId: request.parentSessionId,
          cwd: request.cwd,
          provider: request.route.provider,
          model: request.route.model,
          ...(request.route.reasoningEffort === undefined ? {} : { reasoningEffort: request.route.reasoningEffort }),
          providerProfile: profile,
          environment: { [apiKeyEnv]: selectedCredential.value },
          systemPrompt: 'Complete the delegated task using only the tools authorized for this child.',
          maxSteps: request.limits.maxSteps,
          ...(request.limits.maxTokens === undefined ? {} : { maxTokens: request.limits.maxTokens }),
          permissionMode,
          builtinTools,
          allowedTools,
          ...(canRelay ? { workspaceWriteRoot: parentPolicy.workspaceRoot } : {}),
          parentPolicy,
        }
        runtime = await context.require('acpChildRuntimeLauncher').launch(launchRequest, runSignal)
        const childStderr = runtime.child.stderr
        stderrDrain = (async (): Promise<void> => {
          for await (const _chunk of childStderr) {}
        })()
        void stderrDrain.catch((error: unknown) => {
          stderrFailure ??= new Error(`dsh-acp-child child stderr stream failed: ${errorMessage(error)}`, { cause: error })
          protocolFailure ??= stderrFailure
          if (!aborter.signal.aborted) aborter.abort(stderrFailure)
        })
        void runtime.child.done.catch(() => {})
        runSignal.throwIfAborted()
        connection = app.connect(ndJsonStream(
          Writable.toWeb(runtime.child.stdin),
          Readable.toWeb(runtime.child.stdout) as ReadableStream<Uint8Array>,
        ))
        runSignal.addEventListener('abort', onAbort, { once: true })
        connection.signal.addEventListener('abort', () => {
          if (!promptSettled && !runSignal.aborted) failProtocol('dsh-acp-child ACP connection closed unexpectedly')
        }, { once: true })

        const initialize = await raceAbort(track(connection.agent.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientInfo: { name: '@deepseek-ai/dsh-acp-child', version: '0.1.0' },
          _meta: { 'com.deepseek.ai/dsh-native-subagent': {
            version: NATIVE_ACP_SUBAGENT_PROTOCOL_VERSION,
            permissionRelay: canRelay,
          } },
        })), runSignal)
        if (initialize.protocolVersion !== PROTOCOL_VERSION) throw new Error('dsh-acp-child child selected an unsupported ACP protocol version')
        const capabilities = readNativeAcpSubagentServerCapabilities(initialize._meta)
        if (capabilities === undefined
          || !capabilities.permissionModes.includes(permissionMode)) {
          throw new Error('dsh-acp-child child does not advertise the required Native policy capabilities')
        }

        const requestedPolicy: NativeAcpSubagentPolicy = {
          version: NATIVE_ACP_SUBAGENT_PROTOCOL_VERSION,
          maxSteps: request.limits.maxSteps,
          ...(request.limits.maxTokens === undefined ? {} : { maxTokens: request.limits.maxTokens }),
          permissionMode,
        }
        sessionCreationPending = true
        let created
        try {
          created = await raceAbort(track(connection.agent.request(methods.agent.session.new, {
            cwd: request.cwd,
            mcpServers: [],
            _meta: nativeAcpSubagentPolicyMetadata(requestedPolicy),
          })), runSignal)
        } finally { sessionCreationPending = false }
        sessionId = nonempty(created.sessionId, 'session/new sessionId')
        for (const notification of pendingSessionUpdates.splice(0)) receiveSessionUpdate(notification)
        if (protocolFailure !== undefined) throw protocolFailure
        const effectivePolicy = acceptedPolicy(created._meta, requestedPolicy)
        if (canRelay && effectivePolicy.permissionMode !== 'parent-relay') {
          throw new Error('dsh-acp-child child did not accept parent-relay permission mode')
        }
        negotiatedPermissionMode = effectivePolicy.permissionMode
        await raceAbort(selectExactRoute(connection, sessionId, created.configOptions,
          request.route.provider, request.route.model, request.route.reasoningEffort, track, runSignal), runSignal)

        const promptConnection = connection
        const promptSessionId = sessionId
        let result: Promise<NativeExternalSubagentOutcome> | undefined
        const runPrompt = async (): Promise<NativeExternalSubagentOutcome> => {
          // oxlint-disable-next-line typescript/no-unnecessary-condition -- Later getter calls reuse this cached prompt result.
          if (result !== undefined) return result
          promptStarted = true
          const promptWork = track(promptConnection.agent.request(
            methods.agent.session.prompt, { sessionId: promptSessionId, prompt: content },
          ))
          const operation = (async (): Promise<NativeExternalSubagentOutcome> => {
            try {
              const response = await raceAbort(promptWork, runSignal)
              promptSettled = true
              if (protocolFailure !== undefined) throw protocolFailure
              const outcome: NativeExternalSubagentOutcome = {
                output: assistantText.map(text => ({ type: 'text' as const, text })),
                stopReason: stopReason(response, runSignal),
              }
              await closeRun(false)
              return outcome
            } catch (error) {
              promptSettled = true
              const cancelled = runSignal.aborted
              try { await closeRun(cancelled) } catch (cleanupError) {
                throw new AggregateError([error, cleanupError], 'dsh-acp-child prompt and cleanup failed')
              }
              if (protocolFailure !== undefined) throw protocolFailure
              if (cancelled) return { output: assistantText.map(text => ({ type: 'text' as const, text })), stopReason: 'aborted' }
              throw error
            }
          })()
          result = operation
          return operation
        }
        startup.close = stopRun
        active.add(stopRun)
        runSignal.addEventListener('abort', onAbort, { once: true })
        if (runSignal.aborted) onAbort()
        return {
          remoteId: sessionId,
          get result(): Promise<NativeExternalSubagentOutcome> { return runPrompt() },
          dispose: stopRun,
        }
      } catch (error) {
        try { await closeRun(true) } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'dsh-acp-child startup and cleanup failed')
        }
        throw error
      } finally {
        starting.delete(startup)
        operation.resolve(undefined)
      }
    },
  }
  return driver
}

/** Install the fixed-profile ACP driver selected by the Native Subagent Provider. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-acp-child',
  targets: ['host'],
  requires: ['credentials', 'acpChildRuntimeLauncher'],
  optional: ['attachments'],
  provides: ['externalSubagentDriver'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      const driver = startDriver(context, config)
      const close = (): void => { void driver.dispose().catch(() => {}) }
      context.signal.addEventListener('abort', close, { once: true })
      context.own(async () => {
        context.signal.removeEventListener('abort', close)
        await driver.dispose()
      })
      if (context.signal.aborted) close()
      context.provide('externalSubagentDriver', driver)
    }
  },
}
