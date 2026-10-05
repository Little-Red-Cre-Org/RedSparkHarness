/** Native managed shell environment Provider. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeToolExecution } from '@deepseek-ai/dsh-native-tools'
import { ShellEnvController } from './controller.ts'
import type {} from './definition.ts'

export { ShellEnvController } from './controller.ts'
export type { ShellEnvContributor, ShellEnvironment, ShellEnvVariable, ShellEnvVariableInfo } from './definition.ts'

function resolveConfig(input: unknown): string | undefined {
  if (input === undefined) return undefined
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('shell-env: native configuration must be an object')
  }
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (key !== 'dshHome') throw new Error(`shell-env: unknown native configuration field ${key}`)
  }
  if (fields.dshHome !== undefined && typeof fields.dshHome !== 'string') {
    throw new Error('shell-env: dshHome must be a string')
  }
  return fields.dshHome
}

/** Provide one scoped registry whose contributors release with their native installation. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-shell-env', targets: ['host'],
  requires: [], optional: [], provides: ['shellEnv'],
  resolve(input) {
    const dshHome = resolveConfig(input)
    return (context) => {
      context.provide('shellEnv', new ShellEnvController<NativeToolExecution>(dshHome, call => call.session.header.id))
    }
  },
}
