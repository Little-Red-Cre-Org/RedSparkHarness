import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import type { NativeExternalModelRoute, NativeExternalSubagentModelOperations } from '@deepseek-ai/dsh-native-subagent/native'
import type { CodexProductRun, CodexProductRunSpec } from './run.ts'
import { startCodexProductRun } from './run.ts'
import type { NativeResponsesForward, NativeResponsesGatewayLimits, NativeResponsesProjectRequest } from './responses-gateway.ts'
import { createNativeResponsesGateway } from './responses-gateway.ts'
import { startNativeResponsesServer } from './responses-server.ts'
import { createCodexDynamicToolCatalog } from './dynamic-tools.ts'
import { NativeCodexToolBridge } from './native-tool-bridge.ts'
import { DEFAULT_DISPOSE_GRACE_MS } from './types.ts'

/** Inputs captured for one Native Codex product run. */
export interface NativeCodexProductRunSpec extends Omit<CodexProductRunSpec, 'env' | 'envMode' | 'model' | 'permissionMode'> {
  readonly route: NativeExternalModelRoute
  readonly model: NativeExternalSubagentModelOperations
  readonly forward: NativeResponsesForward
  readonly projectRequest: NativeResponsesProjectRequest
  readonly limits: NativeResponsesGatewayLimits
  /** Parent-owned maximum output tokens for each Responses request. */
  readonly maxTokens?: number
}

/** Isolated Native Codex product run; its paths are owned until `dispose()`. */
export interface NativeCodexProductRun extends CodexProductRun {
  readonly codexHome: string
  readonly configPath: string
  readonly gatewayUrl: string
}

function tomlString(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error('codex-app-server: provider configuration values cannot contain newlines')
  return JSON.stringify(value)
}

function isolatedConfig(model: string, gatewayUrl: string): string {
  return [
    `model = ${tomlString(model)}`,
    'model_provider = "dsh-native-gateway"',
    'approval_policy = "never"',
    'sandbox_mode = "read-only"',
    'check_for_update_on_startup = false',
    '',
    '[model_providers.dsh-native-gateway]',
    'name = "RSH Native Responses Gateway"',
    `base_url = ${tomlString(gatewayUrl)}`,
    'env_key = "DSH_NATIVE_GATEWAY_TOKEN"',
    'wire_api = "responses"',
    'requires_openai_auth = false',
    '',
    '[analytics]',
    'enabled = false',
    '',
  ].join('\n')
}

async function removeOwnedHome(path: string, retryDelay: number): Promise<void> {
  const target = resolve(path)
  const parent = resolve(tmpdir())
  if (dirname(target) !== parent || !target.startsWith(`${parent}${process.platform === 'win32' ? '\\' : '/'}`)
    || !target.split(/[\\/]/).at(-1)?.startsWith('dsh-native-codex-')) {
    throw new Error('codex-app-server: refusing to remove an unowned Native Codex home')
  }
  await rm(target, { recursive: true, force: true, maxRetries: 1, retryDelay })
}

function cleanupFailure(errors: readonly unknown[]): Error | undefined {
  if (errors.length === 0) return undefined
  return errors.length === 1
    ? errors[0] instanceof Error ? errors[0] : new Error(String(errors[0]))
    : new AggregateError(errors, 'codex-app-server: Native product cleanup failed')
}

/** Start Codex with a private local provider configuration and captured model transport.
 * @param texts - The one-shot text task submitted to the isolated Codex thread.
 * @param spec - Core connection, captured Engine model operations, and provider transport.
 * @param signal - Startup and published-run cancellation signal.
 * @returns The app-server run and its operation-scoped gateway/configuration owner.
 */
export async function startNativeCodexProductRun(
  texts: readonly string[],
  spec: NativeCodexProductRunSpec,
  signal: AbortSignal,
): Promise<NativeCodexProductRun> {
  signal.throwIfAborted()
  const disposeGraceMs = spec.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS
  const root = resolve(mkdtempNativeHome())
  const codexHome = join(root, 'codex-home')
  const privateTemp = join(root, 'tmp')
  let server: Awaited<ReturnType<typeof startNativeResponsesServer>> | undefined
  let product: CodexProductRun | undefined
  let disposal: Promise<void> | undefined

  const cleanup = async (): Promise<void> => {
    const errors: unknown[] = []
    if (product !== undefined) {
      try { await product.dispose() } catch (error: unknown) { errors.push(error) }
    }
    if (server !== undefined) {
      try { await server.close() } catch (error: unknown) { errors.push(error) }
    }
    try { await removeOwnedHome(root, disposeGraceMs) } catch (error: unknown) { errors.push(error) }
    const failure = cleanupFailure(errors)
    if (failure !== undefined) throw failure
  }

  try {
    mkdirSync(codexHome)
    mkdirSync(privateTemp)
    const requestToken = randomBytes(32).toString('base64url')
    const catalog = createCodexDynamicToolCatalog(spec.model.tools)
    const toolBridge = new NativeCodexToolBridge(spec.model, catalog)
    const handler = createNativeResponsesGateway({
      route: spec.route,
      model: spec.model,
      toolBridge,
      forward: spec.forward,
      projectRequest: spec.projectRequest,
      ...spec.maxTokens === undefined ? {} : { maxOutputTokens: spec.maxTokens },
      ...spec.reasoningEffort === undefined ? {} : { expectedReasoningEffort: spec.reasoningEffort },
      requestToken,
      limits: spec.limits,
      signal,
    })
    server = await startNativeResponsesServer(handler, requestToken, signal)
    const configPath = join(codexHome, 'config.toml')
    writeFileSync(configPath, isolatedConfig(spec.route.model, server.baseUrl), { encoding: 'utf8', flag: 'wx' })
    const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT
    if (process.platform === 'win32' && systemRoot === undefined) {
      throw new Error('codex-app-server: isolated Native launch requires Windows SystemRoot')
    }
    const homeEnv = {
      CODEX_HOME: codexHome,
      HOME: root,
      USERPROFILE: root,
      APPDATA: join(root, 'appdata'),
      LOCALAPPDATA: join(root, 'localappdata'),
      XDG_CONFIG_HOME: join(root, 'xdg-config'),
      XDG_CACHE_HOME: join(root, 'xdg-cache'),
      XDG_DATA_HOME: join(root, 'xdg-data'),
      TEMP: privateTemp,
      TMP: privateTemp,
      PATH: dirname(process.execPath),
      ...(systemRoot === undefined ? {} : { SystemRoot: systemRoot }),
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
      NO_PROXY: '127.0.0.1,localhost',
      DSH_NATIVE_GATEWAY_TOKEN: requestToken,
    }
    product = await startCodexProductRun(texts, {
      connection: spec.connection,
      cwd: spec.cwd,
      model: spec.route.model,
      ...spec.reasoningEffort === undefined ? {} : { reasoningEffort: spec.reasoningEffort },
      toolBridge,
      permissionMode: 'never',
      envMode: 'replace',
      env: homeEnv,
      disposeGraceMs,
      ...spec.onStderr === undefined ? {} : { onStderr: spec.onStderr },
      ...spec.onError === undefined ? {} : { onError: spec.onError },
    }, signal)
    const run = product
    return {
      remoteId: run.remoteId,
      result: run.result,
      collectOutput: () => run.collectOutput(),
      codexHome,
      configPath,
      gatewayUrl: server.baseUrl,
      dispose: () => disposal ??= cleanup(),
    }
  } catch (error: unknown) {
    try {
      await cleanup()
    } catch (cleanupError: unknown) {
      throw new AggregateError([error, cleanupError], 'codex-app-server: Native product startup and cleanup failed')
    }
    throw error
  }
}

function mkdtempNativeHome(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-native-codex-'))
}
