/** Native durable Session feedback Provider and `/feedback` command Consumer. */
import { isDeepStrictEqual } from 'node:util'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeCommandOperations } from '@deepseek-ai/dsh-commands/native'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/native'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { SessionLogOffset } from '@deepseek-ai/dsh-session/types'
import type { FeedbackRecord, SessionFeedbackRecordResult } from './types.ts'
import type { NativeSessionFeedbackOperations } from './native-definition.ts'
import type {} from './native-definition.ts'

/** Native feedback Provider: one committed log event, no model turn. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-command-feedback',
  targets: ['host'],
  requires: ['activeSessions'],
  optional: ['commands'],
  provides: ['sessionFeedback'],
  resolve(input) {
    if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 0)) {
      throw new Error('command-feedback: native configuration must be an empty object')
    }
    return (context) => {
      const active = context.require('activeSessions')
      const operations: NativeSessionFeedbackOperations = {
        async record(owner: NativeActiveSessionOwner, entry: FeedbackRecord, signal?: AbortSignal): Promise<SessionFeedbackRecordResult> {
          if (active.owner(owner.agent, owner.session) !== owner || owner.invocation !== 'root') {
            return { ok: false, error: { code: 'session-not-found', sessionId: owner.session.id } }
          }
          signal?.throwIfAborted()
          const text = entry.text?.trim() ?? ''
          const event = owner.append('feedback/record', {
            ...(text.length === 0 ? {} : { text }),
            ...(entry.category === undefined ? {} : { category: entry.category }),
          })
          await owner.flush()
          const events = await owner.readCommittedEvents(event.seq + 1)
          if (!isDeepStrictEqual(events[event.seq], event)) {
            throw new Error(`command-feedback: feedback event is not durable for Session '${owner.session.id}'`)
          }
          try {
            await context.events.parallel(owner.agent.scope, 'feedback/committed', {
              owner,
              scope: owner.agent.scope,
              inspection: { meta: owner.session.header, inheritedEventCount: SessionLogOffset(owner.inheritedEventCount), events },
            })
          } catch (error) {
            console.warn('command-feedback: committed feedback observer failed', error)
          }
          return { ok: true, value: { recorded: true } }
        },
      }
      context.provide('sessionFeedback', operations)
      const commands = context.optional('commands') as NativeCommandOperations | undefined
      if (commands !== undefined) context.effect(commands.register({
        definitionId: CommandDefinitionId('@deepseek-ai/dsh-command-feedback'),
        name: 'feedback',
        description: 'Record feedback about this session',
        input: { hint: '<text>' },
        recordInput: false,
        handler: async (invocation) => {
          if (invocation.rawInput.trim().length === 0) {
            return { kind: 'error', text: 'Feedback text is required. Usage: /feedback <text>' }
          }
          const result = await operations.record(invocation.owner, { text: invocation.rawInput }, invocation.signal)
          if (!result.ok) return { kind: 'error', text: `Session ${invocation.owner.session.id} is no longer active.` }
          return { kind: 'success', text: `Feedback recorded for session ${invocation.owner.session.id}\nAnonymous user: ${getOrCreateAnonymousUserId()}.` }
        },
      }))
    }
  },
}
