/**
 * Native entry for the client command surface.
 *
 * ## What this entry is, and what it deliberately is not
 *
 * The Cordis half is three things: the session-keyed command directory, a
 * client-contribution registry (`register`/`decorate`), and a `/` trigger
 * source that the input pipeline drives. A Native host has no input pipeline
 * and no `ui-conversation` composer to own one, and this client already has a
 * `/` palette: `native-application`'s `command-palette.tsx` renders one over
 * its own textarea. Building a second palette here would be a second surface
 * answering the same keystroke, so this entry contributes the parts that
 * palette is missing and the palette keeps owning the rendering:
 *
 * * **One catalog per Session instead of one per hook.** The palette fetches
 *   the catalog into React state and drops it whenever the Session changes.
 *   The cache here is the same {@link CommandDirectory} the Cordis half uses —
 *   single-flight pulls, an epoch guard and a snapshot that survives a
 *   remount — so reopening the menu does not re-round-trip.
 * * **Invalidation.** A preset switch changes which commands a Session's Agent
 *   resolves, and nothing told the Native palette so. The Host's
 *   `agent-presets/updated` notification now reaches
 *   {@link NativeCommandService.invalidate}.
 * * **The localized client face of a built-in command**, so the palette can
 *   show the title, description and glyph the browser menu shows instead of
 *   the Host's English catalog text.
 *
 * The contribution registry is exposed for Native features that own a
 * client-side command. It is driven by the palette's pick, not by an input
 * machine: an `action` contribution runs, and a `popupSelect` contribution has
 * no Native shell to settle an option list through yet — {@link
 * NativeCommandService.pick} reports that difference instead of pretending the
 * pick succeeded.
 */
import type { CommandDescriptor } from '@redspark/rsh-commands/facts'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type {} from '@redspark/rsh-client-native-session/native'
import type {} from '@redspark/rsh-client-locale/native'
import type { NativeLocaleService } from '@redspark/rsh-client-locale/native'
import type { TranslateNS } from '@redspark/rsh-client-ui-slots'
import type { SessionId } from '@redspark/rsh-session/types'
import { CommandDirectory } from './client/catalog.ts'
import type {
  CommandContribution, CommandDecoration,
} from './client/contract-core.ts'
import { builtinRowFace, sectionRows, type MenuRow } from './client/presentation.ts'
import { en, zh } from './client/locales.ts'

/** Dictionary namespace owned by this plugin, shared with the browser build. */
const NS = 'command'

export { en as nativeCommandsEn, zh as nativeCommandsZh, type CommandKey } from './client/locales.ts'
export type { CommandDescriptor, DirectoryStatus } from './client/catalog.ts'
export type {
  ActionSpec, CommandContribution, CommandDecoration, CommandUiSpec, PopupSelectSpec, SelectConfirmation, SelectOption,
} from './client/contract-core.ts'
export type { MenuRow, MenuRowWithIcon, MenuSection } from './client/presentation.ts'
export type { BuiltinCommandName } from './client/resolution.ts'

/**
 * The Host command face this entry drives: a subset of `NativeSessionClient`.
 *
 * `native-application`'s palette declares the same two operations, so a
 * Native command service is drop-in compatible with the face it already calls.
 */
export interface NativeCommandCatalogFace {
  /** List slash commands available to one Session's owner. */
  commands(sessionId: SessionId, signal?: AbortSignal): Promise<readonly CommandDescriptor[]>
  /** Execute one complete slash command line on an idle Session owner. */
  executeCommand(sessionId: SessionId, line: string, signal?: AbortSignal): Promise<unknown>
}

/** One menu row, localized where this package owns the copy. */
export interface NativeCommandRow extends MenuRow {
  /** Menu title: the localized client face, else the command name. */
  readonly label: string
  /** Menu description: the localized client face, else the catalog description. */
  readonly description: string
  /** Whether this row is a first-party definition with client-owned copy. */
  readonly builtin: boolean
}

/** Outcome of one pick routed through this service. */
export type NativeCommandPick =
  /** The catalog line was submitted to the Host. */
  | { readonly kind: 'executed' }
  /** A client-owned `action` contribution consumed the pick. */
  | { readonly kind: 'action' }
  /** A `popupSelect` contribution matched, but no Native shell settles it. */
  | { readonly kind: 'unsupported'; readonly reason: string }
  /** No catalog entry and no contribution answered. */
  | { readonly kind: 'unknown' }

/**
 * The Native command surface: one catalog per Session, the client contribution
 * registries, and the localized menu rows a palette renders.
 */
export interface NativeCommandService extends NativeCommandCatalogFace {
  /**
   * Menu rows for one Session.
   * @param sessionId - Session whose catalog is shown.
   * @param query - text after the slash; empty lists the sectioned rows.
   * @param position - whether the token starts the draft; an inline token hides rows that take arguments.
   * @returns rows in menu order.
   */
  rows(sessionId: SessionId, query: string, position: 'leading' | 'inline'): Promise<readonly NativeCommandRow[]>
  /**
   * Run one chosen row.
   * @param sessionId - Session the pick addresses.
   * @param name - command name without the leading slash.
   * @returns which path settled the pick.
   */
  pick(sessionId: SessionId, name: string): Promise<NativeCommandPick>
  /** Repull every live Session's catalog (a Host command-set change). */
  invalidate(): void
  /**
   * Drop one Session's stale catalog and prewarm its replacement.
   * @param sessionId - Session whose command composition changed.
   */
  resetSession(sessionId: SessionId): void
  /**
   * Register one client-owned command.
   * @param contribution - name, availability, copy and UI behavior.
   * @returns the disposer removing the registration.
   */
  register(contribution: CommandContribution): () => void
  /**
   * Hang a bare-invocation decoration on one Host command.
   * @param decoration - Host command name, availability and UI behavior.
   * @returns the disposer removing the registration.
   */
  decorate(decoration: CommandDecoration): () => void
  /** Namespace translator for this package's copy. */
  readonly t: TranslateNS<'command'>
}

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices {
    /** Session-keyed command catalog and client command registry for Native Clients. */
    clientNativeCommands: NativeCommandService
  }
}

/**
 * Native command Provider: one catalog cache, both contribution registries,
 * and the localized menu rows the existing palette renders.
 */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-client-ui-commands',
  targets: ['client'],
  requires: ['clientNativeSession', 'clientLocale'],
  provides: ['clientNativeCommands'],
  resolve(input) {
    if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length > 0)) throw new TypeError('native commands: this provider takes no configuration')
    return (context) => {
      const client = context.require('clientNativeSession')
      const locale: NativeLocaleService = context.require('clientLocale')
      context.own(locale.register(NS, { en, zh }))
      const t = locale.bind(NS) as TranslateNS<'command'>

      const directory = new CommandDirectory(sessionId => client.commands(sessionId, context.signal))
      const contributions = new Map<string, CommandContribution>()
      const decorations = new Map<string, CommandDecoration>()

      // A preset switch changes which commands one Session's Agent resolves and
      // registers nothing globally, so every live key's composition is dropped
      // and prewarmed. The Native Host reports that on its settings stream.
      const notifications = (async () => {
        try {
          for await (const frame of client.settingsEvents(context.signal)) {
            if (frame.type === 'agent-presets/updated') directory.resetConnected()
          }
        } catch (error: unknown) {
          if (!context.signal.aborted) console.error('native commands: invalidations failed', error)
        }
      })()
      context.effect(async () => { await notifications })

      const presentation = (descriptor: CommandDescriptor): NativeCommandRow => {
        const face = builtinRowFace(descriptor, t)
        return {
          name: descriptor.name,
          label: face?.label ?? descriptor.name,
          description: face?.description ?? descriptor.description,
          ...descriptor.input === undefined ? {} : { hint: descriptor.input.hint },
          builtin: face !== undefined,
        }
      }

      const runContribution = (
        name: string,
        ui: CommandContribution['ui'],
        sessionId: SessionId,
      ): NativeCommandPick => {
        if (ui.kind === 'action') {
          ui.run(sessionId)
          return { kind: 'action' }
        }
        return { kind: 'unsupported', reason: `/${name} opens an option list, and this client has no popupSelect shell` }
      }

      const service: NativeCommandService = {
        // Every consumer reads through the cache, so a palette that remounts or
        // reopens its menu serves the held snapshot instead of re-round-tripping.
        commands: (sessionId, signal) => directory.ensureReady(sessionId, signal ?? context.signal),
        executeCommand: (sessionId, line, signal) => client.executeCommand(sessionId, line, signal ?? context.signal),
        async rows(sessionId, query, position) {
          const catalog = await directory.ensureReady(sessionId, context.signal)
          // A leading slash token only offers rows that take no arguments; an
          // inline token has already committed the rest of the draft to them.
          const visible = catalog
            .filter(descriptor => position === 'leading' || descriptor.input === undefined)
            .map(presentation)
          const needle = query.trim().toLowerCase()
          if (needle !== '') {
            return visible.filter(row =>
              row.name.toLowerCase().includes(needle) || row.label.toLowerCase().includes(needle))
          }
          // Empty query: the Add and Commands sections in usage order, with any
          // unlisted catalog row closing the Commands section in catalog order.
          const byName = new Map(visible.map(row => [row.name, row]))
          return sectionRows(visible, t).flatMap((row) => {
            const source = byName.get(row.name)
            return source === undefined ? [] : [row.section === undefined ? source : { ...source, section: row.section }]
          })
        },
        async pick(sessionId, name) {
          const contribution = contributions.get(name)
          if (contribution !== undefined && contribution.available(sessionId)) {
            return runContribution(name, contribution.ui, sessionId)
          }
          await directory.ensureReady(sessionId, context.signal)
          const decoration = decorations.get(name)
          if (decoration !== undefined && decoration.available(sessionId)) {
            return runContribution(name, decoration.ui, sessionId)
          }
          const descriptor = directory.resolve(sessionId, name)
          if (descriptor === undefined) return { kind: 'unknown' }
          await client.executeCommand(sessionId, `/${descriptor.name}`, context.signal)
          return { kind: 'executed' }
        },
        invalidate: () => { directory.invalidateAll() },
        resetSession: (sessionId) => { directory.resetSession(sessionId) },
        register(contribution) {
          if (contributions.has(contribution.name)) {
            throw new Error(`ui-commands: duplicate contribution for /${contribution.name}`)
          }
          contributions.set(contribution.name, contribution)
          return () => { contributions.delete(contribution.name) }
        },
        decorate(decoration) {
          if (decorations.has(decoration.name)) {
            throw new Error(`ui-commands: duplicate decoration for /${decoration.name}`)
          }
          decorations.set(decoration.name, decoration)
          return () => { decorations.delete(decoration.name) }
        },
        t,
      }
      context.provide('clientNativeCommands', service)
    }
  },
}
