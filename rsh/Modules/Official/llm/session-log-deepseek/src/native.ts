/** Native request Consumer for the exact active Session's durable event suffix. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-deepseek-llm-api-extensions/native'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution/active-session-protocol'
import type { DeepSeekLlmApiExtensionRequest } from '@deepseek-ai/dsh-deepseek-llm-api-extensions/types'
import { resolveConfig } from './config.ts'
import { foldAcceptedThrough, wireUpload } from './wire.ts'

export type * from './types.ts'

/** Require the same captured owner to remain writable through its registration. */
function assertCurrentOwner(operations: NativeActiveSessionOperations, owner: NativeActiveSessionOwner): void {
  if (!owner.writerAvailable || operations.owner(owner.agent, owner.session) !== owner) {
    throw new Error('session-log-deepseek: exact active Session owner is no longer writable')
  }
}

/** Upload accepted Session history through the existing Native active writer. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-session-log-deepseek',
  targets: ['host'],
  requires: ['deepseekLlmApiExtensions', 'activeSessions'],
  provides: [],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      if (!config.enabled) return
      const extensions = context.require('deepseekLlmApiExtensions')
      const activeSessions: NativeActiveSessionOperations = context.require('activeSessions')
      context.effect(extensions.register(context.scope, 'dsh_session_log', {
        prepare: async (request: DeepSeekLlmApiExtensionRequest) => {
          if (request.sessionId === undefined) return undefined
          const owner = activeSessions.owners()
            .find(candidate => String(candidate.session.id) === request.sessionId)
          if (owner === undefined) return undefined
          assertCurrentOwner(activeSessions, owner)
          const events = await owner.readEvents({ signal: request.signal })
          request.signal.throwIfAborted()
          assertCurrentOwner(activeSessions, owner)
          const sessionId = owner.session.id
          const sessionFormatVersion = owner.session.header.version
          const afterSeq = foldAcceptedThrough(sessionId, sessionFormatVersion, events)
          const upload = wireUpload(owner.session, events, afterSeq)
          if (upload === undefined) return undefined
          const { value, throughSeq } = upload
          return {
            value,
            accept: async () => {
              assertCurrentOwner(activeSessions, owner)
              owner.append('session-log-deepseek/delivery-accepted', {
                sessionId,
                sessionFormatVersion,
                throughSeq,
              })
              await owner.flush()
            },
          }
        },
      }))
    }
  },
}
