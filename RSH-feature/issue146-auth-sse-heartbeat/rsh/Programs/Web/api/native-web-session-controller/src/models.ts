/** Authenticated model-directory and discovery RPC operations. */
import { z } from 'zod'
import type { NativeModelDirectory } from '@deepseek-ai/dsh-native-model-execution/model-directory'
import type { NativeModelSettings } from '@deepseek-ai/dsh-llm-pi-ai/native'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection/native-host'

const listRequest = z.strictObject({})
const discoveryRequest = z.strictObject({
  settingsNs: z.string().min(1),
  request: z.strictObject({
    provider: z.string().optional(),
    baseURL: z.string().optional(),
    api: z.string().optional(),
    apiKey: z.string().optional(),
  }),
})

/** Keep browser model operations on the currently selected Native providers. */
export class NativeWebModels {
  /**
   * @param directory - selected provider directory, when installed.
   * @param settings - selected model settings provider, when installed.
   * @param lifetime - controller lifetime; aborting it cancels admitted requests.
   */
  constructor(
    private readonly directory: NativeModelDirectory | undefined,
    private readonly settings: NativeModelSettings | undefined,
    private readonly lifetime: AbortSignal,
  ) {}

  private readonly pending = new Set<Promise<unknown>>()

  /** Handle one authenticated model RPC request.
   * @param endpoint - model RPC endpoint.
   * @param payload - untrusted request fields.
   * @param signal - caller cancellation.
   * @returns model metadata or candidates, with generic failures that expose no draft credential or upstream body.
   */
  handle(endpoint: string, payload: unknown, signal: AbortSignal): Promise<ConnectionRpcResult<unknown>> {
    const result = this.run(endpoint, payload, AbortSignal.any([signal, this.lifetime]))
    this.pending.add(result)
    void result.finally(() => this.pending.delete(result))
    return result
  }

  /** Wait for admitted requests after the controller lifetime aborts them. @returns completion of every admitted request. */
  async close(): Promise<void> {
    await Promise.allSettled(this.pending)
  }

  private async run(endpoint: string, payload: unknown, signal: AbortSignal): Promise<ConnectionRpcResult<unknown>> {
    try {
      signal.throwIfAborted()
      if (endpoint === 'models/providers') {
        listRequest.parse(payload)
        return { ok: true, value: (this.directory?.providers() ?? []).map(({ id, name }) => ({ id, name })) }
      }
      if (endpoint === 'models/configurable-providers') {
        listRequest.parse(payload)
        return { ok: true, value: this.settings?.configurableProviders() ?? [] }
      }
      if (endpoint === 'models/discover') {
        const { settingsNs, request: draft } = discoveryRequest.parse(payload)
        if (this.settings === undefined) throw new Error('model settings provider is unavailable')
        const models = await this.settings.discover(settingsNs, {
          ...draft.provider === undefined ? {} : { provider: draft.provider },
          ...draft.baseURL === undefined ? {} : { baseURL: draft.baseURL },
          ...draft.api === undefined ? {} : { api: draft.api },
          ...draft.apiKey === undefined ? {} : { apiKey: draft.apiKey },
        }, signal)
        return { ok: true, value: models.map(({ id, name, contextWindow, maxTokens }) => ({
          id,
          ...name === undefined ? {} : { name },
          ...contextWindow === undefined ? {} : { contextWindow },
          ...maxTokens === undefined ? {} : { maxTokens },
        })) }
      }
      throw new Error('unsupported endpoint')
    } catch {
      const discovery = endpoint === 'models/discover'
      return { ok: false, error: {
        code: discovery ? 'native/models-discovery' : 'native/models-directory',
        message: discovery ? 'Model discovery failed.' : 'Model directory request failed.',
        details: {},
      } }
    }
  }
}
