/** Native storage publishes the existing named BackendRegistry without IO or a second medium. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { BackendRegistry } from './registry.ts'

export { BackendRegistry } from './registry.ts'
export { StorageError } from './error.ts'
export type { StorageErrorCode } from './error.ts'
export { UNIT_NAME_RE } from './backend.ts'
export type { StorageBackend, KvFacet, KvUnit, KvUnitDescriptor } from './backend.ts'

/** Named backend authority; the owning Providers register and release their exact contributions. */
export interface NativeStorageOperations {
  readonly backend: BackendRegistry
}

/** Selected backend activation has registered its contributions on this exact hub registry. */
export interface NativeStorageBackendsReady {
  readonly registry: BackendRegistry
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { storage: NativeStorageOperations; storageBackendsReady: NativeStorageBackendsReady }
}

/** Native Provider of the same backend registry implementation used by compatibility storage. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-storage', targets: ['host'], requires: [], provides: ['storage'],
  resolve: () => (context) => { context.provide('storage', { backend: new BackendRegistry() }) },
}
