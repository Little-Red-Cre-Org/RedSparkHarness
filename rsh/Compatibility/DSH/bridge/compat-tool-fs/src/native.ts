/** Selected legacy filesystem tools contributing to native registries. */
import { createRequire } from 'node:module'
import type { Context } from '@redspark/cordis'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import {
  validateSupportManifest,
  type CompatDshLifecycleParticipant,
  type CompatPackageManifest,
} from '@redspark/rsh-compat-dsh-runtime/native'
import type {} from '@redspark/rsh-fs'
import type {} from '@redspark/rsh-fs/native'
import type {} from '@redspark/rsh-native-tools/native'
import type {} from '@redspark/rsh-native-prompt/native'
import type {} from '@redspark/rsh-native-sandbox-policy/native'
import type {} from '@redspark/rsh-approval-definition'
import type {} from '@redspark/rsh-sandbox-policy'
import type { Agent } from '@redspark/rsh-agent'
import SystemPrompt from '@redspark/rsh-system-prompt'
import ToolRuntime from '@redspark/rsh-tools'
import * as LegacyToolFs from '@redspark/rsh-tool-fs'

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices { compatToolFs: { readonly kind: 'legacy-tool-fs' } }
}

/**
 * Refuse changed legacy tool metadata before mounting its Cordis plugin.
 * @param manifest - selected package metadata.
 */
export function validateLegacyToolManifest(manifest: CompatPackageManifest): void {
  validateSupportManifest('@redspark/rsh-tool-fs', manifest)
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
  apiVersion: 1, name: '@redspark/rsh-compat-tool-fs', targets: ['host'],
  requires: ['fs', 'tools', 'promptSections', 'compatDshRuntime'], optional: ['sandboxPolicy', 'fsObservationPolicy', 'approval'], provides: ['compatToolFs'],
  resolve(input) {
    const config = resolveConfig(input)
    const require = createRequire(import.meta.url)
    validateLegacyToolManifest(require('@redspark/rsh-tool-fs/package.json') as CompatPackageManifest)
    validateSupportManifest('@redspark/rsh-system-prompt', require('@redspark/rsh-system-prompt/package.json') as CompatPackageManifest)
    validateSupportManifest('@redspark/rsh-tools', require('@redspark/rsh-tools/package.json') as CompatPackageManifest)
    return async (native) => {
      const runtime = native.require('compatDshRuntime')
      const legacy = runtime.context
      const policyEntrySelected = runtime.hasEntry('@redspark/rsh-fs-observation-policy')
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
      const nativeFs = native.require('fs') as import('@redspark/rsh-fs').FileSystem
      const legacyFs = legacy.get('fs')
      if (legacyFs === undefined) {
        const fsMount = runtime.mount('@redspark/rsh-compat-dsh-runtime/fs-adapter', (context) => {
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
        } as unknown as import('@redspark/rsh-sandbox-policy').SandboxPolicyService
        const policyMount = runtime.mount('@redspark/rsh-compat-dsh-runtime/sandbox-policy-adapter', (context) => {
          context.provide('sandboxPolicy', legacyPolicy)
        })
        native.own(() => policyMount.dispose())
        await policyMount.ready
      }
      const eventMount = runtime.mount('@redspark/rsh-compat-dsh-runtime/fs-event-bridge', (context: Context) => {
        context.on('fs/write-intent', (target, actor, next) => native.events.waterfall(native.scope, 'fs/write-intent', next, target, actor))
        context.on('fs/edit-intent', (target, actor, next) => native.events.waterfall(native.scope, 'fs/edit-intent', next, target, actor))
        context.on('fs/observed', (target, observation, actor) => {
          runtime.forwardFsObserved(native.scope, target, observation, actor,
            () => { native.events.emit(native.scope, 'fs/observed', target, observation, actor) })
        })
      })
      native.own(() => eventMount.dispose())
      await eventMount.ready
      const promptMount = runtime.mount('@redspark/rsh-system-prompt', SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false })
      native.own(() => promptMount.dispose())
      await promptMount.ready
      const toolsMount = runtime.mount('@redspark/rsh-tools', ToolRuntime, { mode: 'native' })
      native.own(() => toolsMount.dispose())
      await toolsMount.ready
      if (legacy.get('systemPrompt') === undefined || legacy.get('tools') === undefined) {
        throw new Error('compat-tool-fs: supported Cordis plugins did not provide systemPrompt and tools')
      }
      const toolMount = runtime.mount('@redspark/rsh-tool-fs', LegacyToolFs, config)
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
        if (!runtime.isEnabled('@redspark/rsh-tool-fs')
          || !runtime.isEnabled('@redspark/rsh-tools')
          || !runtime.isEnabled('@redspark/rsh-system-prompt')
          || (policyEntrySelected && !runtime.isEnabled('@redspark/rsh-fs-observation-policy'))
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
