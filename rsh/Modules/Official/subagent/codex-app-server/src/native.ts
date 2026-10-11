import type { NativeContext, NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { NativeExternalSubagentDriver, NativeExternalSubagentRun,
  NativeExternalSubagentRequest, NativeExternalSubagentOutcome } from '@deepseek-ai/dsh-native-subagent/native'
import { startNativeCodexProductRun } from './native-product-run.ts'
import type { NativeResponsesGatewayLimits } from './responses-gateway.ts'
import type { CodexRunStopReason } from './run.ts'
import { DEFAULT_CODEX_PERMISSION_MODE, DEFAULT_DISPOSE_GRACE_MS } from './types.ts'

interface CodexConfig {
  readonly name: string
  readonly limits: NativeResponsesGatewayLimits
  readonly disposeGraceMs: number
}

function resolveConfig(input: unknown): CodexConfig {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('codex-app-server: configuration must be an object')
  }
  const fields = input as Record<string, unknown>
  const allowed = new Set(['name', 'model', 'permissionMode', 'env', 'limits', 'disposeGraceMs'])
  const unsupported = Object.keys(fields).find(key => !allowed.has(key))
  if (unsupported !== undefined) throw new Error(`codex-app-server: unsupported configuration field "${unsupported}"`)
  const name = fields.name ?? 'codex'
  if (fields.model !== undefined) {
    throw new Error('codex-app-server: model is selected by the captured Native route; model configuration is not supported')
  }
  const permissionMode = fields.permissionMode ?? DEFAULT_CODEX_PERMISSION_MODE
  if (permissionMode !== DEFAULT_CODEX_PERMISSION_MODE) {
    throw new Error('codex-app-server: only permissionMode "never" is supported')
  }
  const env = fields.env ?? {}
  if (typeof env !== 'object' || Array.isArray(env)
    || Object.values(env).some(value => typeof value !== 'string')) {
    throw new Error('codex-app-server: env must be a string map')
  }
  if (Object.keys(env).length !== 0) {
    throw new Error('codex-app-server: custom env is not supported by the isolated Native route')
  }
  const limits = fields.limits
  if (limits === null || typeof limits !== 'object' || Array.isArray(limits)) {
    throw new Error('codex-app-server: limits must configure all Responses gateway ceilings')
  }
  const rawLimits = limits as Record<string, unknown>
  const limitFields = ['requestBytes', 'responseBytes', 'jsonDepth', 'sseEvents'] as const
  if (Object.keys(rawLimits).length !== limitFields.length
    || limitFields.some(key => !Object.hasOwn(rawLimits, key))) {
    throw new Error('codex-app-server: limits must configure requestBytes, responseBytes, jsonDepth, and sseEvents')
  }
  for (const key of limitFields) {
    const value = rawLimits[key]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`codex-app-server: limits.${key} must be a positive safe integer`)
    }
  }
  const disposeGraceMs = fields.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS
  if (typeof name !== 'string' || name.length === 0) throw new Error('codex-app-server: name must be nonempty')
  if (typeof disposeGraceMs !== 'number' || !Number.isFinite(disposeGraceMs)
    || disposeGraceMs <= 0 || disposeGraceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`codex-app-server: disposeGraceMs must be positive, finite, and no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  return {
    name,
    limits: rawLimits as unknown as NativeResponsesGatewayLimits,
    disposeGraceMs,
  }
}

function textTask(request: NativeExternalSubagentRequest): string[] {
  if (request.prompt.length === 0 || request.prompt.some(block => block.type !== 'text')) {
    throw new Error('codex-app-server: one-shot task supports text-only input')
  }
  const texts = request.prompt.map(block => block.type === 'text' ? block.text : '')
  if (texts.every(text => text.trim().length === 0)) throw new Error('codex-app-server: one-shot task must not be empty')
  return texts
}

function unsupportedRequest(request: NativeExternalSubagentRequest): void {
  if (request.persona !== undefined) throw new Error('codex-app-server: persona is not supported by this route')
  if (request.toolFilter !== undefined) throw new Error('codex-app-server: toolFilter is not supported by this route')
  if (request.outputSchema !== undefined) throw new Error('codex-app-server: outputSchema is not supported by this route')
  if (request.route.overrides.provider !== undefined) throw new Error('codex-app-server: provider override is not supported')
  if (request.approval !== undefined) {
    throw new Error('codex-app-server: parent approval relay is not supported')
  }
}

function toOutcome(result: { readonly output: readonly { readonly type: 'text'; readonly text: string }[]
  readonly stopReason: CodexRunStopReason }): NativeExternalSubagentOutcome {
  return { output: result.output, stopReason: result.stopReason }
}

function installDriver(context: NativeContext, config: CodexConfig): void {
  const connection = context.require('childConnection')
  const active = new Set<{ dispose(): Promise<void> }>()
  let closing = false
  const driver: NativeExternalSubagentDriver = {
    name: config.name,
    modelProtocol: 'responses',
    routeFields: ['model', 'reasoningEffort'],
    capabilities: Object.assign(
      { persona: false, toolFilter: false, outputSchema: false },
      { approvalRelay: false },
    ),
    async start(request, signal): Promise<NativeExternalSubagentRun> {
      unsupportedRequest(request)
      if (closing) throw new Error('codex-app-server: Host is disposing this provider')
      const texts = textTask(request)
      const responses = request.responses
      if (responses === undefined) {
        throw new Error('codex-app-server: the Engine must capture Responses transport before product startup')
      }
      if (responses.route.provider !== request.route.provider || responses.route.model !== request.route.model) {
        throw new Error('codex-app-server: captured Responses transport does not match the resolved Native route')
      }
      if (request.limits.maxTokens !== undefined && responses.outputTokenLimit !== 'supported') {
        throw new Error('codex-app-server: captured model provider cannot enforce the parent output-token limit')
      }
      const operationController = new AbortController()
      const runSignal = AbortSignal.any([signal, operationController.signal])
      let disposal: Promise<void> | undefined
      const owner = {
        dispose(): Promise<void> {
          return disposal ??= (async () => {
            operationController.abort(new Error('codex-app-server: Host is disposing this Native run'))
            try {
              let app: Awaited<ReturnType<typeof startNativeCodexProductRun>>
              try {
                app = await startup
              } catch (error: unknown) {
                // The start caller sees a clean canceled start; aggregate rollback failures must escape teardown.
                if (!operationController.signal.aborted || error instanceof AggregateError) throw error
                return
              }
              await app.dispose()
            } finally {
              active.delete(owner)
            }
          })()
        },
      }
      active.add(owner)
      const startup = startNativeCodexProductRun(texts, {
        connection,
        cwd: request.cwd,
        route: request.route,
        model: request.model,
        forward: (body, operationSignal) => responses.forward(body, operationSignal),
        projectRequest: (body, operationSignal) => responses.projectRequest(body, operationSignal),
        limits: config.limits,
        ...request.limits.maxTokens === undefined ? {} : { maxTokens: request.limits.maxTokens },
        ...request.route.reasoningEffort === undefined ? {} : { reasoningEffort: request.route.reasoningEffort },
        disposeGraceMs: config.disposeGraceMs,
      }, runSignal)
      let app: Awaited<ReturnType<typeof startNativeCodexProductRun>>
      try {
        app = await startup
      } catch (error: unknown) {
        if (!(error instanceof AggregateError)) active.delete(owner)
        throw error
      }
      if (runSignal.aborted) {
        await owner.dispose()
        throw runSignal.reason
      }
      const dispose = (): Promise<void> => owner.dispose()
      return { remoteId: app.remoteId, result: app.result.then(toOutcome), dispose }
    },
  }
  context.own(async () => {
    closing = true
    const results = await Promise.allSettled([...active].map(run => run.dispose()))
    const failures: unknown[] = []
    for (const result of results) {
      if (result.status === 'rejected') {
        const reason: unknown = result.reason
        failures.push(reason)
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'codex-app-server: Native run teardown failed')
  })
  context.provide('externalSubagentDriver', driver)
}

/** Official Native Codex app-server Provider for Engine's external-child authority. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-codex-app-server',
  targets: ['host'],
  requires: ['childConnection'],
  provides: ['externalSubagentDriver'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) =>{  installDriver(context, config) }
  },
}
