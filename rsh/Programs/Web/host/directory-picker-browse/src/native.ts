/**
 * Native Host provider for one-level directory listing and child-directory creation.
 * @module @redspark/rsh-host-directory-picker-browse/native
 */

import { z } from 'zod'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { DirectoryListing } from '@redspark/rsh-host-directory-picker/types'
import type { NativeDirectoryPicker } from '@redspark/rsh-host-directory-picker/native-capability'
import { createChildDirectory, listDirectory } from './browse.ts'

const configSchema = z.object({
  maxEntries: z.number().int().positive().default(1000),
}).strict()

/** Validated Native browse limits. An omitted field uses the default bound. */
export interface DirectoryBrowseConfig {
  /** Complete-result bound of one listing level, including hidden rows. */
  readonly maxEntries: number
}

/**
 * One-level host directory listing and child creation selected on a Native Host.
 * An omitted list path reads the account home directory. A path that is not fully
 * qualified is rejected instead of resolving against the process working directory.
 */
export interface DirectoryBrowseService {
  /**
   * List one directory level.
   * @param path - absolute directory to list; absent lists the home directory.
   * @param signal - caller lifetime; abort stops the scan and rejects with the abort reason.
   * @returns the level's listing with ancestry.
   */
  list(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  /**
   * Create one child directory under an existing parent.
   * @param path - absolute existing parent directory.
   * @param name - single non-blank path segment.
   * @returns the created directory's absolute path.
   */
  createDirectory(path: string, name: string): Promise<string>
}

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices {
    directoryBrowse: DirectoryBrowseService
  }
}

/**
 * Validate browse limits. The object has no working-directory field, so a profile
 * cannot fall back to the process working directory.
 * @param input - untrusted profile fields; omitted input uses the default bound.
 * @returns frozen `maxEntries` configuration.
 */
export function resolveDirectoryBrowseConfig(input: unknown): DirectoryBrowseConfig {
  return Object.freeze(configSchema.parse(input === undefined ? {} : input))
}

/** Host plugin that provides `directoryBrowse` from the shared filesystem functions. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-host-directory-picker-browse',
  targets: ['host'],
  requires: [],
  optional: [],
  provides: ['directoryBrowse', 'directoryPicker'],
  resolve(input) {
    const config = resolveDirectoryBrowseConfig(input)
    return (context) => {
      const service: DirectoryBrowseService = {
        list: (path, signal) => listDirectory(path, signal, config.maxEntries),
        createDirectory: (path, name) => createChildDirectory(path, name),
      }
      const capability = { kind: 'browse' as const, list: service.list, createDirectory: service.createDirectory }
      const picker: NativeDirectoryPicker = { capability: () => capability }
      context.provide('directoryBrowse', service)
      context.provide('directoryPicker', picker)
    }
  },
}
