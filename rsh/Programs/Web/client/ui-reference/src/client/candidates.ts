/**
 * The `@` menu's candidate projections, shared by the browser and Native source.
 *
 * Rows carry only what distinguishes them: a file names its parent directory
 * (nothing at the workspace root), a directory listing names none because its
 * breadcrumb already does, and a session names its workspace only when that
 * workspace is not the current one. Both halves read these functions, so the
 * two builds cannot disagree about a row's text or its pick payload.
 *
 * The row and crumb shapes are declared here rather than imported from the
 * trigger pipeline: this module is reachable from the Native entry, which must
 * not depend on the Cordis-side contract. They describe the same fields the
 * pipeline accepts.
 *
 * @module @redspark/rsh-client-ui-reference/client/candidates
 */
import { relativeTime } from '@redspark/rsh-client-ui-primitives'
import { formatFileMention } from '@redspark/rsh-file-reference/grammar'
import type { FileReferenceCandidate } from '@redspark/rsh-file-reference/types'
import type { SessionReferenceMentionCandidate } from '@redspark/rsh-session-reference/types'
import { abbreviateHomePath } from '@redspark/rsh-util-workspace-path'
import type { ReferenceKey } from './locales.ts'

/**
 * Translator over this package's `reference` namespace.
 *
 * Declared as the locale service's own key function rather than a widened
 * signature: the pipeline and both halves bind one namespace, so a broader
 * `string` key would let a typo through as a literal.
 */
export type Translate = (key: ReferenceKey, params?: Record<string, unknown>) => string

/** One menu row. Structurally the trigger pipeline's candidate. */
export interface ReferenceRow {
  readonly name: string
  readonly label?: string
  readonly description?: string
  readonly icon?: 'file' | 'folder' | 'session'
  readonly section?: string
  readonly hint?: string
  readonly value?: string
  readonly drill?: boolean
}

/** One breadcrumb step above a drilled listing. */
export interface ReferenceCrumb {
  readonly label: string
  readonly value: string
  readonly current?: boolean
}

/** The source-owned payload behind one row's `value`. */
export type ReferenceCandidateValue =
  | { kind: 'file'; fileKind: FileReferenceCandidate['kind']; label: string; mention: string }
  | { kind: 'session'; label: string; mention: string }

/** What picking one row produces. */
export type ReferencePick =
  /** The mention text that replaces the trigger token. */
  | { readonly kind: 'replace'; readonly text: string; readonly label: string; readonly appearance: 'file' | 'folder' | 'session' }
  /** A drill keeps the menu open on the descended query. */
  | { readonly kind: 'drill'; readonly text: string }

/**
 * The breadcrumb of a drilled directory listing, from the workspace root down
 * to the directory being listed.
 *
 * Only a drill produces one: a path the user typed carries its own context in
 * the draft, while a drill replaced the text they were reading with a deeper
 * one and owes them the way back.
 * @param query - the live query, path text following `@` or `@"`.
 * @param quoted - whether the active token is an open quoted path.
 * @param drilled - whether a drill pick, rather than typing, produced the query.
 * @param t - the reference dictionary.
 * @returns the crumbs, or undefined when this listing needs no header.
 */
export function crumbsFor(
  query: string,
  quoted: boolean,
  drilled: boolean,
  t: Translate,
): readonly ReferenceCrumb[] | undefined {
  if (!drilled) return undefined
  const slash = query.lastIndexOf('/')
  if (slash < 0) return undefined
  const segments = query.slice(0, slash).split('/').filter(segment => segment !== '')
  const crumbs: ReferenceCrumb[] = [{
    label: t('crumb.root'),
    value: directoryValue(t('crumb.root'), quoted ? '@"' : '@'),
  }]
  for (const [index, segment] of segments.entries()) {
    const path = segments.slice(0, index + 1).join('/')
    const mention = formatFileMention({ path, kind: 'directory' }, quoted)
    // A trail whose steps cannot all be written back as mention text would
    // send the user somewhere they did not click; show no header instead.
    if (mention === undefined) return undefined
    crumbs.push({
      label: segment,
      value: directoryValue(segment, mention),
      ...(index === segments.length - 1 ? { current: true } : {}),
    })
  }
  return crumbs
}

/**
 * Project one directory destination as the drill payload `pickOf` already understands.
 * @param label - the crumb text this destination shows.
 * @param mention - the mention text reaching this directory.
 * @returns the row payload as JSON.
 */
export function directoryValue(label: string, mention: string): string {
  const value: ReferenceCandidateValue = { kind: 'file', fileKind: 'directory', label, mention }
  return JSON.stringify(value)
}

/**
 * Project one file or directory candidate as a menu row.
 * @param candidate - ranked path candidate.
 * @param preserveQuote - keep an explicitly opened quote in the mention.
 * @param withLocation - whether the row names the parent directory.
 * @param t - the reference dictionary.
 * @returns one row, or none when the path cannot be written as mention text.
 */
export function fileCandidate(
  candidate: FileReferenceCandidate,
  preserveQuote: boolean,
  withLocation: boolean,
  t: Translate,
): readonly ReferenceRow[] {
  const mention = formatFileMention(candidate, preserveQuote)
  if (mention === undefined) return []
  const slash = candidate.path.lastIndexOf('/')
  const name = candidate.path.slice(slash + 1)
  const parent = slash < 0 ? '' : candidate.path.slice(0, slash)
  const directory = candidate.kind === 'directory'
  const value: ReferenceCandidateValue = {
    kind: 'file',
    fileKind: candidate.kind,
    label: name,
    mention,
  }
  return [{
    name: `${name}${directory ? '/' : ''}`,
    // The location is the parent alone: repeating the name the row already
    // shows says nothing, and a workspace-root entry has no parent to name.
    ...(withLocation && parent !== '' ? { description: parent } : {}),
    icon: directory ? 'folder' : 'file',
    section: t('section.files'),
    value: JSON.stringify(value),
    ...(directory ? { drill: true } : {}),
  }]
}

/**
 * Project one session candidate as a menu row.
 * @param candidate - ranked session candidate carrying its canonical mention.
 * @param updatedAt - durable activity time the row dates itself from.
 * @param now - current clock, so the age reads against one instant.
 * @param home - Host home prefix used to shorten the workspace path.
 * @param t - the reference dictionary.
 * @returns one row.
 */
export function sessionCandidate(
  candidate: SessionReferenceMentionCandidate,
  updatedAt: number,
  now: number,
  home: string | undefined,
  t: Translate,
): ReferenceRow {
  const { unit, n } = relativeTime(updatedAt, now)
  const age = unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
  // Candidates are ranked by workspace affinity, so the location only tells
  // the user something when it is not the workspace they are already in.
  const location = candidate.sameWorkspace
    ? undefined
    : candidate.cwd === undefined ? t('candidate.noCwd') : abbreviateHomePath(candidate.cwd, home)
  const value: ReferenceCandidateValue = {
    kind: 'session',
    label: candidate.label,
    mention: candidate.mention,
  }
  return {
    name: candidate.label,
    description: location === undefined ? age : `${location} · ${age}`,
    icon: 'session',
    section: t('section.sessions'),
    value: JSON.stringify(value),
  }
}

/**
 * Project one row's payload as the pick the caller applies.
 * @param payload - the row's `value`.
 * @param action - settling pick or the row's drill action.
 * @returns what the pick produces, or undefined when the row carries no payload.
 */
export function pickOf(payload: string | undefined, action: 'pick' | 'drill'): ReferencePick | undefined {
  const value = parseCandidate(payload)
  if (value?.kind === 'file') {
    // A directory row carries two verbs: the settling pick resolves the
    // folder itself as an atomic reference, while the drill action keeps the
    // literal descent text and the open menu.
    if (value.fileKind === 'directory' && action === 'drill') return { kind: 'drill', text: value.mention }
    return {
      kind: 'replace',
      text: value.mention,
      label: value.fileKind === 'directory' ? `${value.label}/` : value.label,
      appearance: value.fileKind === 'directory' ? 'folder' : 'file',
    }
  }
  if (value?.kind === 'session') {
    return { kind: 'replace', text: value.mention, label: value.label, appearance: 'session' }
  }
  return undefined
}

/**
 * Read one row's source-owned payload back.
 * @param value - the `value` a row carried.
 * @returns the payload, or undefined when the row carries none.
 */
export function parseCandidate(value: string | undefined): ReferenceCandidateValue | undefined {
  if (value === undefined) return undefined
  return JSON.parse(value) as ReferenceCandidateValue
}
