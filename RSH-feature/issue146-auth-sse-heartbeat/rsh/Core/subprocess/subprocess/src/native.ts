/** Cordis-free subprocess service definition and child-environment helpers. */
import type {} from '@deepseek-ai/dsh-native-runtime'
import type { ChildConnectionDefinition, SubprocessOperations } from './types.ts'

export { disposeChildConnection } from './connection.ts'
export { scrubbedParentEnv, SENSITIVE_ENV_PATTERN } from './environment.ts'
export * from './types.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    subprocess: SubprocessOperations
    childConnection: ChildConnectionDefinition
  }
}
