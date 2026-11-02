/** Native Host Provider for the hidden Archify Skill and automatic request route. */
import { createUserMessage } from '@redspark/rsh-llm/native'
import type { UserMessage } from '@redspark/rsh-llm/native'
import type { NativeContext, NativePlugin } from '@redspark/rsh-native-runtime'
import type { NativeRequestContextProvider } from '@redspark/rsh-request-context-definition'
import { NativeRequestContextProviderId } from '@redspark/rsh-request-context-definition'
import type { NativeToolExecution } from '@redspark/rsh-native-tools'
import type { ShellEnvContributor } from '@redspark/rsh-shell-env/definition'
import type { NativeSkills } from '@redspark/rsh-skill/native'
import { isUserInvocable, renderSkillContent } from '@redspark/rsh-skill/shared'
import {
  ARCHIFY_SKILL_DIRECTORY_ENV,
  ARCHIFY_SKILL_NAME,
  archifyShellEnvValues,
  archifySkillProvider,
  matchesDiagramDelivery,
  resolveConfig,
} from './shared.ts'
import type { ResolvedConfig } from './shared.ts'
import type { ArchifyAutoInvocationSource as AutoInvocationSource } from './types.ts'

export type { ArchifyAutoInvocationSource } from './types.ts'

const REQUEST_CONTEXT_ID = NativeRequestContextProviderId('dsh-archify')
const REQUEST_CONTEXT_ORDER = 200

/** Cordis-free Host entry for @redspark/rsh-archify. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-archify',
  targets: ['host'],
  requires: ['skills', 'shellEnv', 'requestContexts'],
  provides: [],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => { install(context, config) }
  },
}

function install(context: NativeContext, config: ResolvedConfig): void {
  const skills = context.require('skills')
  context.effect(skills.registerProvider(context.scope, () => archifySkillProvider))
  const shellEnv: ShellEnvContributor<NativeToolExecution> = {
    name: 'archify',
    variables: {
      [ARCHIFY_SKILL_DIRECTORY_ENV]: { description: 'Absolute directory containing the pinned Archify Skill resources and CLI.' },
    },
    resolve: archifyShellEnvValues,
  }
  context.effect(context.require('shellEnv').register(shellEnv))
  if (!config.autoInvoke) return

  const provider = requestContextProvider(skills, config)
  context.effect(context.require('requestContexts').register(context.scope, provider))
}

function requestContextProvider(skills: NativeSkills, config: ResolvedConfig): NativeRequestContextProvider {
  return {
    id: REQUEST_CONTEXT_ID,
    order: REQUEST_CONTEXT_ORDER,
    async prepare(request) {
      if (!matchesDiagramDelivery(request.inputs, config)) return { messages: [], commit() {} }
      const skill = await skills.get(ARCHIFY_SKILL_NAME, {
        scope: request.scope,
        cwd: request.owner.session.header.cwd,
        signal: request.signal,
      })
      request.signal.throwIfAborted()
      if (skill === undefined || !isUserInvocable(skill)) return { messages: [], commit() {} }
      const source: AutoInvocationSource = {
        kind: 'archify-auto-invocation', form: 'instructions', reason: 'diagram-delivery-request',
      }
      const message: UserMessage = createUserMessage({
        content: [{ type: 'text', text: renderSkillContent(skill) }],
        source,
      })
      return { messages: [message], commit() {} }
    },
  }
}
