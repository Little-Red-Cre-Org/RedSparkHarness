/**
 * Native host chooser for the directory-picker interaction.
 * The client surface stays on the client installation plan; this entry does not
 * mount Loader rows.
 * @module @redspark/rsh-host-directory-picker-auto/native
 */

import { z } from 'zod'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type {} from '@redspark/rsh-native-web-host/native'
import { launchedThroughSsh } from '@redspark/rsh-launch-environment/native'
import type { LaunchEnvironmentSnapshot } from '@redspark/rsh-launch-environment/native'
import type { NativeDirectoryPicker } from '@redspark/rsh-host-directory-picker/native-capability'
import { createChildDirectory, listDirectory } from '@redspark/rsh-host-directory-picker-browse/browse'
import { pickNativeDirectory } from '@redspark/rsh-host-directory-picker-native/native-picker'
import { canExecute, hasLinuxChooserBinary } from './probe.ts'
import { resolveDirectoryPickerBackend, type DirectoryPickerHostFacts } from './resolve.ts'

/** Validated native chooser limits. */
export interface NativeDirectoryPickerAutoConfig {
  /** Complete-result bound used when the decision is `browse`. */
  readonly maxEntries: number
}

const configSchema = z.object({
  maxEntries: z.number().int().positive().default(1000),
}).strict()

/**
 * Validate chooser limits. Bind host, platform, and display are sampled at activation.
 * @param input - untrusted profile fields; omitted input uses the default bound.
 * @returns frozen `maxEntries` configuration.
 */
export function resolveNativeDirectoryPickerAutoConfig(input: unknown): NativeDirectoryPickerAutoConfig {
  return Object.freeze(configSchema.parse(input === undefined ? {} : input))
}

/**
 * Sample the same boot facts the Cordis chooser reads, from the native web host and launch snapshot.
 * @param bindHost - interface the native web host actually bound.
 * @param environment - immutable launch snapshot.
 * @param platform - host process platform.
 * @param env - process environment sample for display and PATH.
 * @returns facts for {@link resolveDirectoryPickerBackend}.
 */
export function nativeDirectoryPickerFacts(
  bindHost: '127.0.0.1' | '0.0.0.0',
  environment: LaunchEnvironmentSnapshot,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): DirectoryPickerHostFacts {
  return {
    bindHost,
    platform,
    ssh: launchedThroughSsh(environment),
    env,
    linuxChooser: hasLinuxChooserBinary(env.PATH, canExecute),
  }
}

/**
 * Build the stable capability for one sampled decision.
 * @param facts - boot-time host facts.
 * @param maxEntries - browse listing bound.
 * @returns a picker whose capability object does not change.
 */
export function createAutoDirectoryPicker(facts: DirectoryPickerHostFacts, maxEntries: number): NativeDirectoryPicker {
  const kind = resolveDirectoryPickerBackend(facts)
  if (kind === 'native') {
    const capability = {
      kind: 'native' as const,
      pick: pickNativeDirectory,
    }
    return { capability: () => capability }
  }
  const capability = {
    kind: 'browse' as const,
    list: (path?: string, signal?: AbortSignal) => listDirectory(path, signal, maxEntries),
    createDirectory: (path: string, name: string) => createChildDirectory(path, name),
  }
  return { capability: () => capability }
}

/** Host plugin that provides one `directoryPicker` for the bound web host. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-host-directory-picker-auto',
  targets: ['host'],
  requires: ['nativeWebHost', 'launchEnvironment'],
  optional: [],
  provides: ['directoryPicker'],
  resolve(input) {
    const config = resolveNativeDirectoryPickerAutoConfig(input)
    return (context) => {
      const facts = nativeDirectoryPickerFacts(
        context.require('nativeWebHost').host,
        context.require('launchEnvironment'),
      )
      context.provide('directoryPicker', createAutoDirectoryPicker(facts, config.maxEntries))
    }
  },
}
