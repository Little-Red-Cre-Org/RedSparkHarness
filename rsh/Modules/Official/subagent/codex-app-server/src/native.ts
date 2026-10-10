import type { NativeContext, NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { NativeExternalSubagentDriver, NativeExternalSubagentRun,
  NativeExternalSubagentRequest, NativeExternalSubagentOutcome } from '@deepseek-ai/dsh-native-subagent/native'
import { startCodexProductRun } from './run.ts'
import type { CodexRunStopReason } from './run.ts'
import { CODEX_PERMISSION_MODES, DEFAULT_CODEX_PERMISSION_MODE, DEFAULT_DISPOSE_GRACE_MS } from './types.ts'
import type { CodexPermissionMode } from './types.ts'

interface CodexConfig {
  readonly name: string
  readonly model?: string
  readonly permissionMode: CodexPermissionMode
  readonly env: Record<string, string>
  readonly disposeGraceMs: number
}

function resolveConfig(input: unknown): CodexConfig {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('codex-app-server: configuration must be an object')
  }
  const fields = input as Record<string, unknown>
  const allowed = new Set(['name', 'model', 'permissionMode', 'env', 'disposeGraceMs'])
  const unsupported = Object.keys(fields).find(key => !allowed.has(key))
  if (unsupported !== undefined) throw new Error(`codex-app-server: unsupported configuration field "${unsupported}"`)
  const name = fields.name ?? 'codex'
  const model = fields.model
  const permissionMode = fields.permissionMode ?? DEFAULT_CODEX_PERMISSION_MODE
  const env = fields.env ?? {}
  const disposeGraceMs = fields.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS
  if (typeof name !== 'string' || name.length === 0) throw new Error('codex-app-server: name must be nonempty')
  if (model !== undefined && (typeof model !== 'string' || model.length === 0)) {
    throw new Error('codex-app-server: model must be nonempty when supplied')
  }
  if (typeof permissionMode !== 'string' || !CODEX_PERMISSION_MODES.includes(permissionMode as CodexPermissionMode)) {
    throw new Error('codex-app-server: invalid permissionMode')
  }
  if (typeof env !== 'object' || Array.isArray(env)
    || Object.values(env).some(value => typeof value !== 'string')) {
    throw new Error('codex-app-server: env must be a string map')
  }
  if (typeof disposeGraceMs !== 'number' || !Number.isFinite(disposeGraceMs)
    || disposeGraceMs <= 0 || disposeGraceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`codex-app-server: disposeGraceMs must be positive, finite, and no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  return {
    name,
    ...model === undefined ? {} : { model },
    permissionMode: permissionMode as CodexPermissionMode,
    env: env as Record<string, string>,
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

function enforceNativeAuthorityAndLimits(): never {
  throw new Error(
    'codex-app-server: this adapter cannot enforce Native parent authority or execution ceilings; refusing every Native request before product startup',
  )
}

function toOutcome(result: { readonly output: readonly { readonly type: 'text'; readonly text: string }[]
  readonly stopReason: CodexRunStopReason }): NativeExternalSubagentOutcome {
  return { output: result.output, stopReason: result.stopReason }
}

function installDriver(context: NativeContext, config: CodexConfig): void {
  const connection = context.require('childConnection')
  const active = new Set<{ dispose(): Promise<void> }>()
  const driver: NativeExternalSubagentDriver = {
    name: config.name,
    routeFields: ['model', 'reasoningEffort'],
    capabilities: Object.assign(
      { persona: false, toolFilter: false, outputSchema: false },
      { approvalRelay: false },
    ),
    async start(request, signal): Promise<NativeExternalSubagentRun> {
      unsupportedRequest(request)
      enforceNativeAuthorityAndLimits()
      const app = await startCodexProductRun(textTask(request), {
        connection,
        cwd: request.cwd,
        model: config.model ?? request.route.model,
        ...request.route.reasoningEffort === undefined ? {} : { reasoningEffort: request.route.reasoningEffort },
        permissionMode: config.permissionMode,
        env: config.env,
        disposeGraceMs: config.disposeGraceMs,
      }, signal)
      let disposal: Promise<void> | undefined
      const dispose = (): Promise<void> => disposal ??= app.dispose().finally(() => { active.delete(owner) })
      const owner = { dispose }
      active.add(owner)
      return { remoteId: app.remoteId, result: app.result.then(toOutcome), dispose }
    },
  }
  context.own(async () => { await Promise.all([...active].map(run => run.dispose())) })
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
