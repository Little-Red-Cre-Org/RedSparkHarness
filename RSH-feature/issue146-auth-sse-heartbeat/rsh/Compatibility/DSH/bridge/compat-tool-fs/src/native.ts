/** Selected legacy filesystem tools contributing to native registries. */
import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import {
  validateSupportManifest,
  type CompatDshLifecycleParticipant,
  type CompatPackageManifest,
} from '@deepseek-ai/dsh-compat-dsh-runtime/native'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-fs/native'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import type {} from '@deepseek-ai/dsh-native-prompt/native'
import type {} from '@deepseek-ai/dsh-native-sandbox-policy/native'
import type {} from '@deepseek-ai/dsh-approval-definition'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as LegacyToolFs from '@deepseek-ai/dsh-tool-fs'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { compatToolFs: { readonly kind: 'legacy-tool-fs' } }
}

/**
 * Refuse changed legacy tool metadata before mounting its Cordis plugin.
 * @param manifest - selected package metadata.
 */
export function validateLegacyToolManifest(manifest: CompatPackageManifest): void {
  validateSupportManifest('@deepseek-ai/dsh-tool-fs', manifest)
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
  requires: ['fs', 'tools', 'promptSections', 'compatDshRuntime'], optional: ['sandboxPolicy', 'fsObservationPolicy', 'approval'], provides: ['compatToolFs'],
  resolve(input) {
    const config = resolveConfig(input)
    const require = createRequire(import.meta.url)
    validateLegacyToolManifest(require('@deepseek-ai/dsh-tool-fs/package.json') as CompatPackageManifest)
    validateSupportManifest('@deepseek-ai/dsh-system-prompt', require('@deepseek-ai/dsh-system-prompt/package.json') as CompatPackageManifest)
    validateSupportManifest('@deepseek-ai/dsh-tools', require('@deepseek-ai/dsh-tools/package.json') as CompatPackageManifest)
    return async (native) => {
      const runtime = native.require('compatDshRuntime')
      const legacy = runtime.context
      const policyEntrySelected = runtime.hasEntry('@deepseek-ai/dsh-fs-observation-policy')
      const active = new Set<Promise<unknown>>()
      // Keep expected admission cancellation out of Loader drain failures while returning the original rejection.
      const trackActive = <T>(work: Promise<T>, cancellation?: AbortSignal): Promise<T> => {
        const drain = cancellation === undefined ? work : work.catch((error: unknown) => {
          if (cancellation.aborted && error === cancellation.reason) return
          throw error
        })
        active.add(drain)
        void drain.then(
          () => { active.delete(drain) },
          () => { active.delete(drain) },
        )
        return work
      }
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
      const approvalSelected = native.optional('approval') !== undefined
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
        context.on('fs/observed', (target, observation, actor) => {
          runtime.forwardFsObserved(native.scope, target, observation, actor,
            () => { native.events.emit(native.scope, 'fs/observed', target, observation, actor) })
        })
      })
      native.own(() => eventMount.dispose())
      await eventMount.ready
      const promptMount = runtime.mount('@deepseek-ai/dsh-system-prompt', SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false })
      native.own(() => promptMount.dispose())
      await promptMount.ready
      const toolsMount = runtime.mount('@deepseek-ai/dsh-tools', ToolRuntime, { mode: 'native' })
      native.own(() => toolsMount.dispose())
      await toolsMount.ready
      if (legacy.get('systemPrompt') === undefined || legacy.get('tools') === undefined) {
        throw new Error('compat-tool-fs: supported Cordis plugins did not provide systemPrompt and tools')
      }
      const toolMount = runtime.mount('@deepseek-ai/dsh-tool-fs', LegacyToolFs, config)
      native.own(() => toolMount.dispose())
      await toolMount.ready
      const registry = native.require('tools')
      const promptSections = native.require('promptSections')
      let toolDisposers: (() => Promise<void>)[] = []
      let promptDispose: (() => void) | undefined
      let suspended = true
      const suspend = async (): Promise<void> => {
        if (suspended) return
        suspended = true
        const disposers = toolDisposers
        toolDisposers = []
        const prompt = promptDispose
        promptDispose = undefined
        prompt?.()
        const outcomes = await Promise.allSettled([...disposers.map(dispose => dispose()), ...active])
        const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
          .map(outcome => outcome.reason as unknown)
        if (failures.length === 1) throw failures[0]
        if (failures.length > 1) throw new AggregateError(failures, 'compat-tool-fs: Native contributions failed to drain')
      }
      const resume = async (): Promise<void> => {
        if (!suspended) return
        if (!runtime.isEnabled('@deepseek-ai/dsh-tool-fs')
          || !runtime.isEnabled('@deepseek-ai/dsh-tools')
          || !runtime.isEnabled('@deepseek-ai/dsh-system-prompt')
          || (policyEntrySelected && !runtime.isEnabled('@deepseek-ai/dsh-fs-observation-policy'))
          || legacy.get('fs') === undefined
          || legacy.get('tools') === undefined
          || legacy.get('systemPrompt') === undefined) {
          return
        }
        const disposers: (() => Promise<void>)[] = []
        try {
          for (const schema of legacy.tools.schemas()) {
            const approvalReason = schema.name === 'write'
              ? 'Writing a file changes the selected workspace.'
              : schema.name === 'edit' ? 'Editing a file changes the selected workspace.' : undefined
            disposers.push(registry.register({
              schema,
              execute: (call) => {
                const signal = AbortSignal.any([call.signal, native.signal])
                return trackActive((async () => {
                  if (approvalSelected && approvalReason !== undefined) {
                    const args = call.arguments as { sandbox_permissions?: string; justification?: string }
                    // Explicit escalation stays with the legacy sandbox approval path.
                    if (args.sandbox_permissions === undefined || args.justification === undefined) {
                      if (call.authorize === undefined) throw new Error(`native-tools: tool ${call.name} requires an approval authority`)
                      await call.authorize({ reason: approvalReason }, signal)
                    }
                  }
                  // The selected legacy tools read only Session and signal from their Agent argument.
                  const agent = { session: call.session } as Agent
                  const result = await legacy.tools.execute({
                    callId: call.callId, name: call.name, arguments: call.arguments, agent,
                    signal,
                  })
                  return {
                    content: result.content,
                    isError: result.isError,
                    ...result.error?.info === undefined ? {} : { error: result.error.info },
                  }
                })(), signal)
              },
            }))
          }
          const prompt = promptSections.register({
            name: 'compat:tool-fs', order: 1100,
            text: () => {
              if (suspended) return ''
              return trackActive(legacy.systemPrompt.assemble().then(assembly =>
                assembly.sections.filter(section => section.name.startsWith('tool:')).map(section => section.text).join('\n\n')))
            },
          })
          toolDisposers = disposers
          promptDispose = prompt
          suspended = false
        } catch (error) {
          await Promise.allSettled(disposers.map(dispose => dispose()))
          throw error
        }
      }
      const participant: CompatDshLifecycleParticipant = { suspend, resume }
      const unregisterParticipant = runtime.registerLifecycleParticipant(participant)
      native.own(async () => {
        unregisterParticipant()
        await suspend()
      })
      await resume()
      native.provide('compatToolFs', { kind: 'legacy-tool-fs' })
    }
  },
}
