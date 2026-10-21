/**
 * Incremental session-log contribution for official DeepSeek LLM API requests.
 * Accepted sequence watermarks live in the canonical log, so restart recovery
 * can conservatively resend uncertain tails without maintaining another store.
 * @module @deepseek-ai/dsh-session-log-deepseek
 */

import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import { SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type {
  Session,
  SessionEvent,
  SessionId,
  SessionLogOffset as SessionLogOffsetType,
  SessionSeqCursor,
} from '@deepseek-ai/dsh-session'
import { Config } from './config.ts'
import { foldAcceptedThrough, wireUpload } from './wire.ts'

export type * from './types.ts'
export { Config }

/** Cordis plugin name. */
export const name = 'session-log-deepseek'
/** Services required to resolve sessions and contribute the provider request field. */
export const inject = ['deepseekLlmApiExtensions', 'sessions']

interface AcceptanceFold {
  readonly scannedEvents: SessionLogOffsetType
  readonly throughSeq: SessionSeqCursor
}

const acceptanceFolds = new WeakMap<Session, AcceptanceFold>()

/**
 * Highest confirmed sequence for this exact Session format generation.
 * @param session - canonical log whose matching acceptance events are folded.
 * @returns greatest accepted sequence, or `-1` before any accepted request.
 */
export function acceptedThrough(session: Session): SessionSeqCursor {
  const previous = acceptanceFolds.get(session)
  const length = session.seq
  const start = previous?.scannedEvents ?? SessionLogOffset(0)
  const freshEvents = function* (): IterableIterator<SessionEvent> {
    for (let index = start; index < length; index++) {
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      const event = session.eventAt(SessionSeq(index))
      if (event === undefined) {
        throw new Error(`session-log-deepseek: missing event ${String(index)} below captured length ${String(length)}`)
      }
      yield event
    }
  }
  const throughSeq = foldAcceptedThrough(session.id, session.header.version, freshEvents(), previous?.throughSeq ?? -1)
  acceptanceFolds.set(session, { scannedEvents: length, throughSeq })
  return throughSeq
}

/**
 * Register the incremental `dsh_session_log` request contribution when enabled.
 * @param ctx - plugin context carrying Sessions and the DeepSeek request-extension registry.
 * @param config - validated opt-in configuration.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.enabled !== true) return
  ctx.deepseekLlmApiExtensions.register('dsh_session_log', {
    prepare: (request) => {
      if (request.sessionId === undefined) return undefined
      const session = ctx.sessions.get(brandString<SessionId>(request.sessionId))
      if (session === undefined) return undefined

      const afterSeq = acceptedThrough(session)
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      const snapshot = session.snapshotEvents()
      const upload = wireUpload(session, snapshot, afterSeq)
      if (upload === undefined) return undefined
      const { value, throughSeq } = upload
      return {
        value,
        accept: () => {
          session.append('session-log-deepseek/delivery-accepted', {
            sessionId: session.id,
            sessionFormatVersion: session.header.version,
            throughSeq,
          })
          // TODO: Add an immediate lightweight checkpoint if duplicate replay after a 2xx crash window becomes unacceptable.
        },
      }
    },
  })
}
