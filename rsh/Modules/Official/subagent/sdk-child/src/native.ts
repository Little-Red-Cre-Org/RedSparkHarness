/** Native Module adapter for the standard dsh Native SDK child runtime. */

import type { StoredImageAttachment } from '@deepseek-ai/dsh-attachment/native'
import type { NativePlugin, NativeContext } from '@deepseek-ai/dsh-native-runtime'
import type { NativeExternalSubagentDriver, NativeExternalSubagentOutcome,
  NativeExternalSubagentRun } from '@deepseek-ai/dsh-native-subagent/native'
import { AssistantOutputFold } from '@deepseek-ai/dsh-subagent-protocol/assistant-output'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/native'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session/native'
import { credentialKey, credentialRef, isCredentialKeySegment } from '@deepseek-ai/dsh-credentials/native'
import { createNativeSdkChildHarness, type NativeSdkChildRuntimeRequest } from '@deepseek-ai/dsh-sdk-runtime'
import type { NativeSdkChildApprovalRelay } from '@deepseek-ai/dsh-sdk-runtime/native'
import type { SdkPromptContentBlock } from '@deepseek-ai/dsh-sdk-protocol'
import type {} from '@deepseek-ai/dsh-attachment/native'

interface Config {
  readonly providerName: string
  readonly providers: Readonly<Record<string, unknown>>
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`dsh-sdk-native ${field} must be an object`)
  return value as Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonempty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new TypeError(`dsh-sdk-native ${field} must be a nonempty trimmed string`)
  }
  return value
}

function resolveConfig(input: unknown): Config {
  const fields = record(input, 'configuration')
  if (Object.keys(fields).some(field => !['providerName', 'providers'].includes(field))) {
    throw new TypeError('dsh-sdk-native configuration accepts only providerName and providers')
  }
  const providerName = nonempty(fields.providerName ?? 'dsh-sdk', 'providerName')
  const providers = fields.providers === undefined ? {} : record(fields.providers, 'providers')
  return { providerName, providers: Object.freeze({ ...providers }) }
}

function endReason(events: readonly SessionEvent[]): TurnEndReason | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'turn/end') return event.data.reason
  }
  return undefined
}

function stopReason(reason: TurnEndReason | undefined): NativeExternalSubagentOutcome['stopReason'] {
  switch (reason?.kind) {
    case 'completed': return 'completed'
    case 'max-tokens': return 'max-tokens'
    case 'aborted': return 'aborted'
    case 'blocked': return 'refusal'
    default: return 'error'
  }
}

async function promptBlocks(
  context: NativeContext,
  blocks: readonly ContentBlock[],
  signal: AbortSignal,
): Promise<SdkPromptContentBlock[]> {
  const output: SdkPromptContentBlock[] = []
  for (const block of blocks) {
    signal.throwIfAborted()
    if (block.type === 'text') {
      output.push({ type: 'text', text: block.text })
      continue
    }
    if (block.type !== 'image') throw new Error(`dsh-sdk-native does not support delegated prompt block "${block.type}"`)
    const attachments = context.optional('attachments')
    if (attachments === undefined) throw new Error('dsh-sdk-native needs the Host attachments service to transfer image prompts')
    const stored: StoredImageAttachment = await attachments.readImage(block.attachment, signal)
    output.push({ type: 'image', data: Buffer.from(stored.data).toString('base64'), mimeType: stored.ref.mediaType })
  }
  return output
}

function createDriver(context: NativeContext, config: Config): NativeExternalSubagentDriver & { dispose(): Promise<void> } {
  const active = new Set<() => Promise<void>>()
  const starting = new Set<{ readonly settled: Promise<void>; close?: () => Promise<void> }>()
  const lifetime = new AbortController()
  let closed = false
  let closing: Promise<void> | undefined

  async function dispose(): Promise<void> {
    if (closing !== undefined) return closing
    closed = true
    lifetime.abort(new Error('dsh-sdk-native is closing'))
    const starts = [...starting]
    const startupClosures = starts.map(start => start.close?.() ?? Promise.resolve())
    closing = (async () => {
      const startupResults = await Promise.allSettled(startupClosures)
      await Promise.all(starts.map(start => start.settled))
      const runResults = await Promise.allSettled([...active].map(disposeRun => disposeRun()))
      const errors = [...startupResults, ...runResults]
        .flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, 'dsh-sdk-native child cleanup failed')
    })()
    return closing
  }

  const driver: NativeExternalSubagentDriver & { dispose(): Promise<void> } = {
    name: config.providerName,
    routeFields: ['provider', 'model', 'reasoningEffort'],
    capabilities: { persona: false, toolFilter: false, outputSchema: false, approvalRelay: true },
    dispose,
    async start(request, signal): Promise<NativeExternalSubagentRun> {
      if (closed) throw new Error('dsh-sdk-native is closing')
      const operation = Promise.withResolvers<void>()
      const startup = { settled: operation.promise } as { settled: Promise<void>; close?: () => Promise<void> }
      starting.add(startup)
      const childSignal = AbortSignal.any([signal, context.signal, lifetime.signal])
      try {
        childSignal.throwIfAborted()
        const input = await promptBlocks(context, request.prompt, childSignal)
        childSignal.throwIfAborted()
        const parentPolicy = request.authority.sandboxPolicy
        if (parentPolicy === undefined) throw new Error('dsh-sdk-native requires the exact parent Session sandbox policy')
        if (parentPolicy.sessionId !== undefined && parentPolicy.sessionId !== request.parentSessionId) {
          throw new Error('dsh-sdk-native received a sandbox policy for a different parent Session')
        }
        const providerProfile = config.providers[request.route.provider]
        if (!isRecord(providerProfile)) {
          throw new Error(`dsh-sdk-native has no inherited provider profile for route "${request.route.provider}"`)
        }
        const rawApiKeyEnv = providerProfile.apiKeyEnv
        if (rawApiKeyEnv === undefined) {
          const stored = isCredentialKeySegment(request.route.provider)
            ? await context.require('credentials').readRecord(credentialKey('llm-pi-ai', request.route.provider)) : undefined
          if (stored !== undefined) throw new Error(`dsh-sdk-native does not inherit stored OAuth or API-key records for "${request.route.provider}"`)
          throw new Error(`dsh-sdk-native requires an explicit apiKeyEnv for route "${request.route.provider}"`)
        }
        const apiKeyEnv = nonempty(rawApiKeyEnv, `providers.${request.route.provider}.apiKeyEnv`)
        const selectedCredential = await context.require('credentials').resolve(credentialRef(apiKeyEnv))
        if (selectedCredential === undefined || selectedCredential.value.length === 0) {
          throw new Error(`dsh-sdk-native has no credential for provider route "${request.route.provider}"`)
        }
        childSignal.throwIfAborted()
        const environment = { [apiKeyEnv]: selectedCredential.value }
        const builtinGrants = Object.freeze(request.authority.builtinToolNames
          .filter((name): name is 'read_file' | 'write_file' => name === 'read_file' || name === 'write_file'))
        const parentApproval = request.approval
        if (builtinGrants.includes('write_file')
          && (!parentApproval || !request.authority.approvalRequired || parentPolicy.mode !== 'workspace-write')) {
          throw new Error('dsh-sdk-native requires parent approval and a workspace write fence for write_file')
        }
        const parentApprovalRelay = builtinGrants.includes('write_file') && parentApproval !== undefined
          && request.authority.approvalRequired && parentPolicy.mode === 'workspace-write'
        const childRequest: NativeSdkChildRuntimeRequest = {
          parentSessionId: request.parentSessionId,
          cwd: request.cwd,
          provider: request.route.provider,
          model: request.route.model,
          providerProfile,
          environment,
          builtinTools: builtinGrants,
          parentApprovalRelay,
          parentPolicy,
        }
        const runtime = await context.require('sdkChildRuntimeLauncher').launch(childRequest, childSignal)
        let runtimeCleanup: Promise<void> | undefined
        startup.close = (): Promise<void> => runtimeCleanup ??= runtime.dispose()
        childSignal.throwIfAborted()
        const options = {
          cwd: request.cwd,
          processCwd: request.cwd,
          provider: request.route.provider,
          model: request.route.model,
          maxSteps: request.limits.maxSteps,
          allowedTools: builtinGrants,
          ...builtinGrants.includes('write_file') && parentPolicy.mode === 'workspace-write'
            ? { workspaceWriteRoot: parentPolicy.workspaceRoot } : {},
          ...request.route.reasoningEffort === undefined ? {} : { reasoningEffort: request.route.reasoningEffort },
          ...request.limits.maxTokens === undefined ? {} : { maxTokens: request.limits.maxTokens },
        }
        const approvalRelay: NativeSdkChildApprovalRelay | undefined = !parentApprovalRelay ? undefined : {
          operationId: String(request.id),
          request: async (approval: unknown, relaySignal) => {
            relaySignal.throwIfAborted()
            childSignal.throwIfAborted()
            if (typeof approval !== 'object' || approval === null || Array.isArray(approval)) return 'unavailable'
            const fields = approval as Record<string, unknown>
            if (fields.operationId !== String(request.id) || fields.sessionId !== childSessionId
              || fields.toolName !== 'write_file' || typeof fields.requestId !== 'string' || fields.requestId.length === 0
              || typeof fields.callId !== 'string' || fields.callId.length === 0
              || fields.reason !== undefined && typeof fields.reason !== 'string') {
              return 'unavailable'
            }
            return parentApproval.request({
              operationId: request.id, requestId: fields.requestId, toolName: 'write_file', callId: fields.callId,
              ...fields.reason === undefined ? {} : { reason: fields.reason },
              signal: AbortSignal.any([childSignal, relaySignal]),
            })
          },
        }
        const harness = createNativeSdkChildHarness(options, runtime, approvalRelay)
        let closeTask: Promise<void> | undefined
        const close = (): Promise<void> => closeTask ??= harness.close()
        startup.close = close
        const cancelled = Promise.withResolvers<undefined>()
        const onAbort = (): void => {
          cancelled.resolve(undefined)
          void close().catch(() => {})
        }
        childSignal.addEventListener('abort', onAbort, { once: true })
        if (childSignal.aborted) onAbort()
        try {
          await Promise.race([harness.start(), cancelled.promise.then(() => { throw new Error('dsh-sdk-native child startup was cancelled') })])
          childSignal.throwIfAborted()
          const effective = harness.initializedWith?.maxSteps
          if (typeof effective !== 'number' || !Number.isSafeInteger(effective)
            || effective <= 0 || effective > request.limits.maxSteps) {
            throw new Error('dsh-sdk-native child did not negotiate a valid maxSteps ceiling')
          }
        } catch (error) {
          childSignal.removeEventListener('abort', onAbort)
          throw error
        }

        const session = harness.session()
        const childSessionId = session.id
        const fold = new AssistantOutputFold()
        let disposeTask: Promise<void> | undefined
        const disposeRun = (): Promise<void> => {
          if (disposeTask !== undefined) return disposeTask
          disposeTask = close().finally(() => {
            childSignal.removeEventListener('abort', onAbort)
            active.delete(disposeRun)
          })
          return disposeTask
        }
        active.add(disposeRun)
        const result: Promise<NativeExternalSubagentOutcome> = Promise.race([
          session.run(input, { onNotification: (notification) => {
            if (notification.method !== 'session.event' || notification.params.sessionId !== session.id) return
            const event = notification.params.event
            if (typeof event === 'object' && event !== null && typeof (event as { type?: unknown }).type === 'string') {
              fold.push(event as SessionEvent)
            }
          } }).then((run) => {
            const reason = endReason(run.events)
            return { output: fold.collect() ?? [], stopReason: stopReason(reason) }
          }),
          cancelled.promise.then(() => ({ output: fold.collect() ?? [], stopReason: 'aborted' as const })),
        ]).catch(() => ({ output: fold.collect() ?? [], stopReason: childSignal.aborted ? 'aborted' : 'error' }))
        return { remoteId: session.id, result, dispose: disposeRun }
      } catch (error) {
        try { await startup.close?.() } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'dsh-sdk-native startup and cleanup failed')
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

/** Install the SDK child adapter; the Subagent Provider remains the only scheduler and result publisher. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-sdk-child',
  targets: ['host'],
  requires: ['credentials', 'sdkChildRuntimeLauncher'],
  optional: ['attachments'],
  provides: ['externalSubagentDriver'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      const driver = createDriver(context, config)
      const dispose = (): void => { void driver.dispose().catch(() => {}) }
      context.signal.addEventListener('abort', dispose, { once: true })
      context.own(async () => {
        context.signal.removeEventListener('abort', dispose)
        await driver.dispose()
      })
      if (context.signal.aborted) dispose()
      context.provide('externalSubagentDriver', driver)
    }
  },
}
