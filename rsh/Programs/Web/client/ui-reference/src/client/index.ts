/**
 * Unified Web `@` reference source. File and session discovery run through
 * the cancellable generated Remote namespaces in parallel with deterministic
 * ordering and labels.
 *
 * Row projection lives in `./candidates.ts` and is shared with the Native half:
 * the two builds differ in where discovery comes from, never in what a row says
 * or what picking it produces.
 *
 * @module @redspark/rsh-client-ui-reference/client
 */
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@redspark/rsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@redspark/rsh-client-locale/client'
import type {} from '@redspark/rsh-client-ui-sidebar-right/client'
import type { Context as ClientContext } from '@redspark/cordis'
import type { ISessions } from '@redspark/rsh-api-session-controller/client'
import type {
  ClientSessionContext, InputTriggerServiceContract, InputTriggerSource,
} from '@redspark/rsh-client-ui-input-trigger/client'
import type { SessionReferenceMentionCandidate } from '@redspark/rsh-session-reference/types'
import { fileAddressFor } from '@redspark/rsh-util-workspace-path'
import { crumbsFor, fileCandidate, pickOf, sessionCandidate } from './candidates.ts'
import { en, NS, zh } from './locales.ts'

export {
  crumbsFor, directoryValue, fileCandidate, parseCandidate, pickOf, sessionCandidate,
  type ReferenceCandidateValue, type ReferenceCrumb, type ReferencePick, type ReferenceRow, type Translate,
} from './candidates.ts'

/** Required services: the trigger registry, the Remote namespaces, and the copy. */
export const inject = [
  'inputTriggers', 'locale', 'sessions', 'remote', 'remote.fileReferences',
  'remote.sessionReferenceResolver', 'sidebarRight',
]

/**
 * Register the combined `@file` / `@session` source.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-reference: dictionaries')
  const t = ctx.locale.bind(NS)
  const sessions = ctx.get('sessions') as ISessions
  const source: InputTriggerSource = {
    trigger: '@',
    name: 'reference',
    showGroupTitle: false,
    async candidates(session: ClientSessionContext, { query, quoted, drilled, signal }) {
      const fileLookup = ctx.remote.fileReferences.list(session.sessionId, query, signal)
        .then(result => result.ok ? result.value : [])
      const sessionLookup = quoted === true
        ? Promise.resolve([] as SessionReferenceMentionCandidate[])
        : ctx.remote.sessionReferenceResolver.candidates(session.sessionId, query, signal)
          .then(result => result.ok ? result.value : [])
      const [fileItems, sessionItems] = await Promise.all([fileLookup, sessionLookup])
      if (signal.aborted) return []
      // The header already names the directory being listed; rows repeat it only
      // when there is no header to carry it.
      const withLocation = crumbsFor(query, quoted === true, drilled, t) === undefined
      const now = Date.now()
      const home = ctx.remote.$host.home
      const listed = sessions.list.getSnapshot().byId
      return [
        ...fileItems.flatMap(candidate => fileCandidate(candidate, quoted === true, withLocation, t)),
        ...sessionItems.map(candidate => sessionCandidate(
          candidate,
          listed[candidate.sessionId]?.updatedAt ?? candidate.createdAt,
          now,
          home,
          t,
        )),
      ]
    },
    header(_session: ClientSessionContext, req) {
      return crumbsFor(req.query, req.quoted === true, req.drilled, t)
    },
    onPick({ candidate, action }) {
      const pick = pickOf(candidate.value, action)
      if (pick === undefined) return undefined
      if (pick.kind === 'drill') return { text: pick.text, continue: true }
      return {
        insert: {
          source: 'reference',
          ref: pick.text,
          label: pick.label,
          appearance: pick.appearance,
          clipboardText: pick.text,
        },
      }
    },
    openReference(session, { ref, appearance }) {
      if (appearance !== 'file') return false
      const path = ref.startsWith('@"') ? ref.slice(2, -1) : ref.slice(1)
      const cwd = sessions.list.getSnapshot().byId[session.sessionId]?.cwd
      ctx.sidebarRight.openResource(fileAddressFor(session.sessionId, cwd, path))
      return true
    },
    codec: {
      clipboardText: ref => ref,
      serialize: ref => Promise.resolve(ref),
    },
  }
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => inputTriggers.registerSource(source), 'ui-reference: @ source')
}
