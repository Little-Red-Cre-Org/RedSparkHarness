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
 * Discovery differs in one respect worth stating. The browser resolver ranks
 * candidates by workspace affinity on the Host; here the list is already the
 * Host's own projection, so the filter and the rank run over the rows the
 * client holds. The pick produces the same `insert`/`text` outcomes the browser
 * source produces, so the Native input pipeline applies it through the same
 * dispatch path a `/` command takes.
 *
 * @module @redspark/rsh-client-ui-reference/native
 */
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { SessionId } from '@redspark/rsh-session/types'
import type { NativeFileReferencesClient, NativeSessionListItem } from '@redspark/rsh-client-native-session/native'
import type {} from '@redspark/rsh-client-locale/native'
import type {} from '@redspark/rsh-client-ui-input-trigger/native'
import type {} from '@redspark/rsh-client-connection/native'
import type { NativeConversationService } from '@redspark/rsh-client-ui-session/native'
import type { SessionReferenceMentionCandidate } from '@redspark/rsh-session-reference/types'
// Browser-safe subpath: the package root imports the Cordis service.
import { formatSessionReferenceMention } from '@redspark/rsh-session-reference/uri'
import { crumbsFor, fileCandidate, pickOf, sessionCandidate, type Translate } from './client/candidates.ts'
import { en, NS, zh } from './client/locales.ts'

export {
  crumbsFor, directoryValue, fileCandidate, parseCandidate, pickOf, sessionCandidate,
  type ReferenceCandidateValue, type ReferenceCrumb, type ReferencePick, type ReferenceRow, type Translate,
} from './client/candidates.ts'
export { NS, en, zh } from './client/locales.ts'
export type { ReferenceKey } from './client/locales.ts'

/** Candidate cap one query may return, matching the Host resolver's default. */
const SESSION_CANDIDATE_LIMIT = 50

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
 * @returns mention-carrying candidates in rank order.
 */
export function sessionCandidatesFor(
  sessions: readonly NativeSessionReferenceRow[],
  askingSessionId: SessionId,
  query: string,
): readonly SessionReferenceMentionCandidate[] {
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
    .map(({ candidate }) => candidate)
}

/** The Session facts `@session` rows are built from; a subset of the listed row. */
export interface NativeSessionReferenceRow {
  readonly header: { readonly id: SessionId; readonly cwd?: string | undefined; readonly createdAt: number }
  readonly titleProjection: NativeSessionListItem['titleProjection']
  /** Latest committed Session event time. */
  readonly updatedAt: number
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
export function createReferenceSource(faces: NativeReferenceFaces, t: Translate) {
  return {
    trigger: '@' as const,
    name: 'reference',
    showGroupTitle: false,
    async candidates(session: { readonly sessionId: SessionId }, req: {
      readonly query: string
      readonly quoted?: boolean | undefined
      readonly drilled: boolean
      readonly signal: AbortSignal
    }) {
      const snapshot = faces.conversation.getSnapshot()
      const fileLookup = faces.files.search(session.sessionId, req.query, req.signal)
        // A failed search is an empty file group, exactly as the browser half
        // treats a failed Remote result; the session group still answers.
        .catch(() => [])
      // A quoted path names a file, so the session group is suppressed: it
      // would answer a question the user did not ask.
      const sessionLookup = req.quoted === true
        ? []
        : sessionCandidatesFor(snapshot.sessions, session.sessionId, req.query)
      const fileItems = await fileLookup
      if (req.signal.aborted) return []
      const withLocation = crumbsFor(req.query, req.quoted === true, req.drilled, t) === undefined
      const now = Date.now()
      const listed = new Map(snapshot.sessions.map(row => [row.header.id, row.updatedAt]))
      return [
        ...fileItems.flatMap(candidate => fileCandidate(candidate, req.quoted === true, withLocation, t)),
        ...sessionLookup.map(candidate => sessionCandidate(
          candidate,
          listed.get(candidate.sessionId) ?? candidate.createdAt,
          now,
          faces.home,
          t,
        )),
      ]
    },
    header(_session: { readonly sessionId: SessionId }, req: {
      readonly query: string
      readonly quoted?: boolean | undefined
      readonly drilled: boolean
    }) {
      return crumbsFor(req.query, req.quoted === true, req.drilled, t)
    },
    onPick(pick: {
      readonly candidate: { readonly name: string; readonly value?: string | undefined }
      readonly action: 'pick' | 'drill'
    }) {
      const outcome = pickOf(pick.candidate.value, pick.action)
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
      clipboardText: (ref: string) => ref,
      serialize: (ref: string) => Promise.resolve(ref),
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
    const t = locale.bind(NS)
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
