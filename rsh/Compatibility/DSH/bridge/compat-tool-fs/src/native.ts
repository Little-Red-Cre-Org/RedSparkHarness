/** Selected legacy filesystem tools contributing to native registries. */
import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-compat-dsh-runtime/native'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-fs/native'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import type {} from '@deepseek-ai/dsh-native-prompt/native'
import type {} from '@deepseek-ai/dsh-native-sandbox-policy/native'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as LegacyToolFs from '@deepseek-ai/dsh-tool-fs'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { compatToolFs: { readonly kind: 'legacy-tool-fs' } }
}

interface LegacyManifest {
  dsh?: { runtime?: { apiVersion?: unknown; role?: unknown; capability?: unknown } }
}

/**
 * Refuse changed legacy tool metadata before mounting its Cordis plugin.
 * @param manifest - selected package metadata.
 */
export function validateLegacyToolManifest(manifest: LegacyManifest): void {
  const runtime = manifest.dsh?.runtime
  if (runtime?.apiVersion !== 1 || runtime.role !== 'consumer' || runtime.capability !== 'filesystem') {
    throw new Error('compat-tool-fs: unsupported @deepseek-ai/dsh-tool-fs runtime declaration')
  }
}

/** Explicit supported config fields for the first filesystem tool adapter. */
export interface Config {
  readLimit?: number
  readMaxLineLength?: number
  readMaxBytes?: number
  readStreamMinSize?: number
}

function resolveConfig(input: unknown): Config {
  if (input === undefined) return {}
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('compat-tool-fs: configuration must be an object')
  const fields = input as Record<string, unknown>
  const allowed = ['readLimit', 'readMaxLineLength', 'readMaxBytes', 'readStreamMinSize']
  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.includes(key)) throw new Error(`compat-tool-fs: unsupported configuration field ${key}`)
    if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`compat-tool-fs: ${key} must be a positive integer`)
  }
  return fields
}

/** Bridge native filesystem, tool, prompt and observation slots to the supported legacy plugin. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-compat-tool-fs', targets: ['host'],
  requires: ['fs', 'tools', 'promptSections', 'compatDshRuntime'], optional: ['sandboxPolicy'], provides: ['compatToolFs'],
  resolve(input) {
    const config = resolveConfig(input)
    const require = createRequire(import.meta.url)
    validateLegacyToolManifest(require('@deepseek-ai/dsh-tool-fs/package.json') as LegacyManifest)
    return async (native) => {
      const runtime = native.require('compatDshRuntime')
      const legacy = runtime.context
      const active = new Set<Promise<unknown>>()
      const nativeFs = native.require('fs') as import('@deepseek-ai/dsh-fs').FileSystem
      const legacyFs = legacy.get('fs')
      if (legacyFs === undefined) {
        const fsMount = runtime.mount('@deepseek-ai/dsh-compat-dsh-runtime/fs-adapter', (context) => {
          context.provide('fs', nativeFs)
        })
        native.own(() => fsMount.dispose())
        await fsMount.ready
      }
      const sandboxPolicy = native.optional('sandboxPolicy')
      if (sandboxPolicy !== undefined && legacy.get('sandboxPolicy') === undefined) {
        const legacyPolicy = {
          defaultMode: sandboxPolicy.defaultMode,
          resolve: sandboxPolicy.resolve.bind(sandboxPolicy),
        } as unknown as import('@deepseek-ai/dsh-sandbox-policy').SandboxPolicyService
        const policyMount = runtime.mount('@deepseek-ai/dsh-compat-dsh-runtime/sandbox-policy-adapter', (context) => {
          context.provide('sandboxPolicy', legacyPolicy)
        })
        native.own(() => policyMount.dispose())
        await policyMount.ready
      }
      const eventMount = runtime.mount('@deepseek-ai/dsh-compat-dsh-runtime/fs-event-bridge', (context: Context) => {
        context.on('fs/write-intent', (target, actor, next) => native.events.waterfall(native.scope, 'fs/write-intent', next, target, actor))
        context.on('fs/edit-intent', (target, actor, next) => native.events.waterfall(native.scope, 'fs/edit-intent', next, target, actor))
        context.on('fs/observed', (target, observation, actor) => { native.events.emit(native.scope, 'fs/observed', target, observation, actor) })
      })
      native.own(() => eventMount.dispose())
      await eventMount.ready
      const promptMount = runtime.mount('@deepseek-ai/dsh-system-prompt', SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false })
      native.own(() => promptMount.dispose())
      await promptMount.ready
      const toolsMount = runtime.mount('@deepseek-ai/dsh-tools', ToolRuntime, { mode: 'native' })
      native.own(() => toolsMount.dispose())
      await toolsMount.ready
      const toolMount = runtime.mount('@deepseek-ai/dsh-tool-fs', LegacyToolFs, config)
      native.own(() => toolMount.dispose())
      await toolMount.ready
      native.own(async () => {
        await Promise.allSettled([...active])
      })
      const registry = native.require('tools')
      for (const schema of legacy.tools.schemas()) {
        const dispose = registry.register({
          schema,
          execute: (call) => {
            // The selected legacy tools read only session and signal from their Agent argument.
            const agent = { session: call.session } as Agent
            const work = legacy.tools.execute({
              callId: call.callId, name: call.name, arguments: call.arguments, agent,
              signal: AbortSignal.any([call.signal, native.signal]),
            }).then(result => ({
              content: result.content,
              isError: result.isError,
              ...result.error?.info === undefined ? {} : { error: result.error.info },
            }))
            active.add(work)
            void work.then(() => active.delete(work), () => active.delete(work))
            return work
          },
        })
        native.own(dispose)
      }
      native.own(native.require('promptSections').register({
        name: 'compat:tool-fs', order: 1100,
        text: async () => {
          const assembly = await legacy.systemPrompt.assemble()
          return assembly.sections.filter(section => section.name.startsWith('tool:')).map(section => section.text).join('\n\n')
        },
      }))
      native.provide('compatToolFs', { kind: 'legacy-tool-fs' })
    }
  },
}
