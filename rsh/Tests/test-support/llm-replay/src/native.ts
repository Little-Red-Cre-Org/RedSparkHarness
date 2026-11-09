/**
 * Native replay Provider: the keyless model substitution for Native snapshots.
 *
 * The Cordis entry registers an `llm` adapter or waterfall listener; the Native
 * runtime has no Cordis Context, so this entry provides the `model` service the
 * Native model-execution Provider consumes instead. The scripted-entry engine is
 * shared with the Cordis entry: the same recorded sessions, the same override
 * sidecars, and the same per-session positional cursor.
 * @module @redspark/rsh-llm-replay/native
 */
import { delimiter as pathDelimiter } from 'node:path'
import { type GenerateOptions, type LlmImageRequestPricing, type LlmResolvedModelInfo,
  type PreparedAdapterCall, type StreamChunk, resolveRetryPolicy, type ResolvedRetryPolicy } from '@redspark/rsh-llm/native'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { NativeModel } from '@redspark/rsh-native-model-execution'
import { loadSessionScripts, resolveScriptedEntry, type ReplayConfig, type ReplayEntry, type ReplayProviderConfig } from './index.ts'

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices { model: NativeModel }
}

/** Replay Provider configuration; each field defaults to its `RSH_SNAPSHOT_*` environment variable. */
export interface Config {
  /** Override the fixture path; defaults to `$RSH_SNAPSHOT_FILE`. */
  file?: string
  /** Override the sidecar path; defaults to `$RSH_SNAPSHOT_OVERRIDE`. */
  overrideFile?: string
  /** Override the child-log paths; defaults to `$RSH_SNAPSHOT_CHILD_FILES`. */
  childFiles?: string[]
  /** Optional replay-only provider catalog published to model selection. */
  providers?: ReplayProviderConfig[]
  /** Optional per-chunk pacing delay in ms. */
  paceMs?: number
}

/** Resolved configuration with environment defaults applied. */
function resolveConfig(input: unknown): ReplayConfig {
  const config = (input ?? {}) as Config
  const file = config.file ?? process.env.RSH_SNAPSHOT_FILE
  if (file === undefined || file.length === 0) {
    throw new Error('llm-replay: a fixture path is required (Config.file or $RSH_SNAPSHOT_FILE)')
  }
  const overrideFile = config.overrideFile ?? process.env.RSH_SNAPSHOT_OVERRIDE
  const childEnv = process.env.RSH_SNAPSHOT_CHILD_FILES
  const childFiles = config.childFiles
    ?? (childEnv !== undefined && childEnv.length > 0 ? childEnv.split(pathDelimiter) : [])
  return {
    file,
    ...overrideFile !== undefined && overrideFile.length > 0 ? { overrideFile } : {},
    ...childFiles.length > 0 ? { childFiles } : {},
    ...config.providers !== undefined ? { providers: config.providers } : {},
    ...config.paceMs !== undefined ? { paceMs: config.paceMs } : {},
  }
}

/** Per-session positional replay over the recorded scripts. */
class ReplayModel implements NativeModel {
  private readonly bound = new Map<string, { entries: ReplayEntry[]; cursor: number }>()
  private nextScript = 0
  private readonly paceMs: number
  private readonly scripts: readonly { entries: ReplayEntry[] }[]
  private readonly providers: ReadonlyMap<string, ReplayProviderConfig>

  constructor(config: ReplayConfig) {
    this.paceMs = config.paceMs ?? 0
    if (!Number.isInteger(this.paceMs) || this.paceMs < 0) {
      throw new Error(`llm-replay: paceMs must be a non-negative integer, got ${String(config.paceMs)}`)
    }
    this.scripts = loadSessionScripts(config)
    this.providers = new Map((config.providers ?? []).map(provider => [provider.id, provider]))
  }

  /** Bind a new live session to the next unclaimed script, exactly as the Cordis replay does. */
  private stateFor(sessionId: string | undefined): { entries: ReplayEntry[]; cursor: number; unrecorded: boolean } {
    const key = sessionId ?? '\0anon\0'
    const existing = this.bound.get(key)
    if (existing !== undefined) return { ...existing, unrecorded: false }
    const script = this.scripts[this.nextScript]
    if (script === undefined) return { entries: [], cursor: 0, unrecorded: true }
    this.nextScript += 1
    const state = { entries: script.entries, cursor: 0 }
    this.bound.set(key, state)
    return { ...state, unrecorded: false }
  }

  /** Resolve the exact selected model's declared capabilities. */
  resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const configured = this.providers.get(provider)
    const configuredModel = configured?.models?.find(candidate => candidate.id === model)
    return Promise.resolve({
      provider,
      id: model,
      name: configuredModel?.name ?? model,
      ...configuredModel?.description === undefined ? {} : { description: configuredModel.description },
      ...configuredModel?.contextWindow === undefined ? {} : { contextWindow: configuredModel.contextWindow },
      ...configuredModel?.inputModalities === undefined
        ? {}
        : { inputModalities: [...configuredModel.inputModalities] },
    })
  }

  /** Prepare the replay route; it supports every output-token limit a recording carried. */
  async prepareCall(provider: string, model: string): Promise<PreparedAdapterCall> {
    return {
      model: await this.resolveModel(provider, model),
      supportsOutputTokenLimit: () => Promise.resolve(true),
      stream: options => this.stream(options),
    }
  }

  /** Read one provider's declared retry policy. */
  retryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    const configured = this.providers.get(provider)
    if (configured?.retryPolicy === undefined) return undefined
    return resolveRetryPolicy(configured.retryPolicy, `llm-replay: provider "${provider}" retryPolicy`)
  }

  /** Price retained request images through the declared flat visual tokens. */
  imageRequestPricing(provider: string, model: string): LlmImageRequestPricing | undefined {
    const visualTokens = this.providers.get(provider)?.models?.find(candidate => candidate.id === model)?.imageRequestTokens
    if (visualTokens === undefined) return undefined
    return {
      priceImages: images => images.map(ref => ({
        visualTokens,
        text: `<${ref.mediaType}> image, ${ref.width}x${ref.height} px, ${ref.bytes} bytes`,
      })),
    }
  }

  /** Stream the next scripted entry for the requesting session. */
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const { entries, cursor, unrecorded } = this.stateFor(options.sessionId)
    if (unrecorded) {
      throw new Error('llm-replay: a live session made a model call the recording does not contain')
    }
    const raw = entries[cursor]
    if (raw === undefined) {
      throw new Error(`llm-replay: session ${String(options.sessionId)} exhausted its ${entries.length} scripted entr(ies)`)
    }
    // Advance synchronously at invocation time so concurrent callers keep their order.
    const state = this.bound.get(options.sessionId ?? '\0anon\0')
    if (state !== undefined) state.cursor = cursor + 1
    yield* this.emit(resolveScriptedEntry(raw, options.messages), options.signal)
  }

  private async *emit(entry: ReplayEntry, signal: AbortSignal | undefined): AsyncIterable<StreamChunk> {
    switch (entry.kind) {
      case 'chunks':
        for (const chunk of entry.chunks) {
          if (signal?.aborted) throw new Error('aborted')
          if (this.paceMs > 0) await new Promise(resolve => setTimeout(resolve, this.paceMs))
          yield chunk
        }
        return
      case 'throw':
        for (const chunk of entry.chunks) {
          if (signal?.aborted) throw new Error('aborted')
          if (this.paceMs > 0) await new Promise(resolve => setTimeout(resolve, this.paceMs))
          yield chunk
        }
        throw new Error(entry.message)
      case 'hang':
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'partial' }
        await new Promise<void>((_resolve, reject) => {
          if (signal?.aborted) { reject(new Error('aborted')); return }
          signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
        })
        return
    }
  }
}

/** Replay Provider selected explicitly by a Native test profile. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@redspark/rsh-llm-replay', targets: ['host'],
  requires: [], provides: ['model'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => { context.provide('model', new ReplayModel(config)) }
  },
}
