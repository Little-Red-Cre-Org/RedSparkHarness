/**
 * Native entry for the `@` reference source.
 *
 * The browser half discovers files through a Host Remote and sessions through
 * the host-side reference resolver. A Native client has both facts locally: the
 * Session workspace-files client answers path search, and the durable Session
 * list already carries every session's id, workspace and age. This half
 * therefore supplies the same source over those two faces and reads the SAME
 * row projection — `./client/candidates.ts` — as the browser.
 *
 * Discovery is where the halves differ, and only partly. The Host resolver
 * filters and ranks candidates before the browser sees them; a Native client has
 * no Host resolver to ask, so `sessionCandidatesFor` applies the same rule —
 * exclude the asking Session, match title/id/workspace, prefer the shared
 * workspace — over the rows the client already holds.
 *
 * @module @redspark/rsh-client-ui-reference/native
 */
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { SessionId } from '@redspark/rsh-session/types'
import type { NativeFileReferencesClient, NativeSessionListItem } from '@redspark/rsh-client-native-session/native'
import type {} from '@redspark/rsh-client-locale/native'
import type { InputTriggerSource } from '@redspark/rsh-client-ui-input-trigger/native'
import type {} from '@redspark/rsh-client-connection/native'
import type { NativeConversationService } from '@redspark/rsh-client-ui-session/native'
import type { SessionReferenceMentionCandidate } from '@redspark/rsh-session-reference/types'
// Browser-safe subpath: the package root imports the Cordis service.
import { formatSessionReferenceMention } from '@redspark/rsh-session-reference/uri'
import { crumbsFor, fileCandidate, pickOf, sessionCandidate, type ReferenceTranslate } from './client/candidates.ts'
import { en, NS, zh } from './client/locales.ts'

export {
  crumbsFor, directoryValue, fileCandidate, parseCandidate, pickOf, sessionCandidate,
  type ReferenceCandidateValue, type ReferenceCrumb, type ReferencePick, type ReferenceRow, type ReferenceTranslate,
} from './client/candidates.ts'
export { NS, en, zh } from './client/locales.ts'
export type { ReferenceKey } from './client/locales.ts'

/**
 * Candidate cap one query may return.
 *
 * The Host resolver's cap is a per-deployment setting the client cannot read
 * before asking, so this is the protocol's own ordering bound rather than a
 * mirror of that configuration: a Native client lists what it already holds.
 */
const SESSION_CANDIDATE_LIMIT = 50

/** One ranked session candidate and the activity time its row dates itself from. */
export interface NativeSessionCandidate {
  readonly candidate: SessionReferenceMentionCandidate
  /** Latest committed Session event time for that row. */
  readonly updatedAt: number
}

/**
 * Rank one candidate against the asking Session: the same workspace first, a
 * different recorded workspace next, no recorded workspace last.
 * @param candidate - the row being ranked.
 * @returns a sort key, lower first.
 */
function sessionAffinity(candidate: SessionReferenceMentionCandidate): number {
  if (candidate.sameWorkspace) return 0
  return candidate.cwd === undefined ? 2 : 1
}

/**
 * Project the durable Session list into `@session` candidates.
 *
 * The asking Session is excluded: referencing the conversation being written
 * would cite a log that does not yet contain the message.
 * @param sessions - Host-ordered durable Session rows.
 * @param askingSessionId - the Session whose composer is open.
 * @param query - text after `@`, matched case-insensitively against title, id and workspace.
 * @returns candidates in rank order, each with its row's activity time.
 */
export function sessionCandidatesFor(
  sessions: readonly NativeSessionListItem[],
  askingSessionId: SessionId,
  query: string,
): readonly NativeSessionCandidate[] {
  const needle = query.toLocaleLowerCase()
  const asking = sessions.find(row => row.header.id === askingSessionId)?.header.cwd
  return sessions
    .filter(row => row.header.id !== askingSessionId)
    .map((row, index) => {
      const label = row.titleProjection.status === 'resolved'
        ? row.titleProjection.title : row.header.id
      const candidate: SessionReferenceMentionCandidate = {
        sessionId: row.header.id,
        label,
        ...row.header.cwd === undefined ? {} : { cwd: row.header.cwd },
        sameWorkspace: row.header.cwd !== undefined && row.header.cwd === asking,
        createdAt: row.header.createdAt,
        mention: formatSessionReferenceMention({ sessionId: row.header.id, label }),
      }
      return { candidate, row, index }
    })
    .filter(({ candidate, row }) => needle === ''
      || candidate.label.toLocaleLowerCase().includes(needle)
      || row.header.id.toLocaleLowerCase().includes(needle)
      || row.header.cwd?.toLocaleLowerCase().includes(needle) === true)
    .sort((left, right) => sessionAffinity(left.candidate) - sessionAffinity(right.candidate)
      || left.index - right.index)
    .slice(0, SESSION_CANDIDATE_LIMIT)
    .map(({ candidate, row }) => ({ candidate, updatedAt: row.updatedAt }))
}

/** What the source reads from the Native client. */
export interface NativeReferenceFaces {
  /** Durable Session list of the open conversation. */
  readonly conversation: Pick<NativeConversationService, 'getSnapshot' | 'subscribe'>
  /** Per-Session workspace path search. */
  readonly files: Pick<NativeFileReferencesClient, 'search'>
  /** Host home directory, used only to shorten displayed workspace paths. */
  readonly home: string | undefined
}

/**
 * The `@` source over Native-local discovery.
 * @param faces - Session list, workspace search and the Host home.
 * @param t - the `reference` namespace translator.
 * @returns one trigger source for the Native input pipeline.
 */
export function createReferenceSource(faces: NativeReferenceFaces, t: ReferenceTranslate): InputTriggerSource {
  return {
    trigger: '@',
    name: 'reference',
    showGroupTitle: false,
    async candidates(session, req) {
      const snapshot = faces.conversation.getSnapshot()
      // A rejected search is an empty file group, exactly as the browser half
      // treats a failed Remote result. Cancellation also lands here; the
      // signal check below is what decides a superseded query, so both the
      // refusal and the abort reach the same answer without this branch
      // having to tell them apart.
      const fileLookup = faces.files.search(session.sessionId, req.query, req.signal).catch(() => [])
      // A quoted path names a file, so the session group is suppressed: it
      // would answer a question the user did not ask.
      const sessionLookup = req.quoted === true
        ? []
        : sessionCandidatesFor(snapshot.sessions, session.sessionId, req.query)
      const fileItems = await fileLookup
      if (req.signal.aborted) return []
      const withLocation = crumbsFor(req.query, req.quoted === true, req.drilled, t) === undefined
      const now = Date.now()
      return [
        ...fileItems.flatMap(candidate => fileCandidate(candidate, req.quoted === true, withLocation, t)),
        ...sessionLookup.map(({ candidate, updatedAt }) => sessionCandidate(
          candidate, updatedAt, now, faces.home, t,
        )),
      ]
    },
    header(_session, req) {
      return crumbsFor(req.query, req.quoted === true, req.drilled, t)
    },
    onPick({ candidate, action }) {
      const outcome = pickOf(candidate.value, action)
      if (outcome === undefined) return undefined
      if (outcome.kind === 'drill') return { text: outcome.text, continue: true }
      return {
        insert: {
          source: 'reference',
          ref: outcome.text,
          label: outcome.label,
          appearance: outcome.appearance,
          clipboardText: outcome.text,
        },
      }
    },
    codec: {
      clipboardText: ref => ref,
      serialize: ref => Promise.resolve(ref),
    },
  }
}

/** Native `@` reference source: workspace files and durable sessions over Native faces. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-client-ui-reference',
  targets: ['client'],
  requires: ['clientLocale', 'clientNativeFileReferences', 'clientNativeConversation', 'clientNativeInputTrigger', 'clientConnection'],
  optional: [],
  provides: [],
  resolve: () => (context) => {
    const locale = context.require('clientLocale')
    context.own(locale.register(NS, { en, zh }))
    const t = locale.bind(NS) as ReferenceTranslate
    const triggers = context.require('clientNativeInputTrigger')
    const connection = context.require('clientConnection')
    const source = createReferenceSource({
      conversation: context.require('clientNativeConversation'),
      files: context.require('clientNativeFileReferences'),
      // The Host home rides each connection generation. Reading it per call
      // keeps the path abbreviation correct across a reconnect to another Host.
      get home() { return connection.generation.getSnapshot()?.host.home },
    }, t)
    context.own(triggers.registerSource(source))
  },
}
