/**
 * Cordis-free subagent surfaces for Native Client consumers.
 *
 * The Cordis half owns two jobs: the session-header lineage switcher and the
 * read-only composer claim. Both read Session facts a Native host already
 * holds, so they port as pure components.
 *
 * The lineage switcher is the one that had to change shape. In the Cordis
 * half it reaches into `useSessions` for `subagentsByParent` and `byId`; a
 * Native host has no such service, so the two derived maps arrive as plain
 * props, computed by the caller from whatever Session data it holds. The
 * descendant fold below is the same one the Cordis entry uses, so both
 * surfaces agree on what "a child" means.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReactElement } from 'react'
import { en as commonEn, formatLocaleTemplate, zh as commonZh } from '@deepseek-ai/dsh-client-locale/dictionary'
import {
  indexSubagentDescendants, type SubagentDescendantSummary,
} from './client/subagent-lineage.ts'
import { SubagentReadOnlyComposer, type SubagentReadOnlyMatch } from './client/SubagentReadOnlyComposer.tsx'
import { en, NS, zh, type SubagentKey } from './client/locales.ts'

export { NS, en, zh, type SubagentKey } from './client/locales.ts'
export { indexSubagentDescendants } from './client/subagent-lineage.ts'
export type { SubagentDescendantSummary } from './client/subagent-lineage.ts'
export type { SubagentReadOnlyMatch } from './client/SubagentReadOnlyComposer.tsx'

/** Props of the read-only composer notice: the selector's reason arrives from the caller. */
export interface NativeSubagentReadOnlyComposerProps {
  /** Why this addressed conversation cannot accept human input. */
  readonly matched: SubagentReadOnlyMatch
  /** Locale for the notice copy, so no locale service is required. */
  readonly locale: 'en' | 'zh'
}

/**
 * Deciding claim for one addressed child, as the Cordis composer chain
 * selector states it: a one-shot child is always read-only, and a continuable
 * child is read-only only once its parent is known to be unavailable (a
 * still-running child keeps the default composer so it can be stopped).
 * @param child - the addressed child, when the selected Session is one.
 * @returns the read-only reason, or null to keep the normal composer.
 */
export function nativeSubagentReadOnlyMatch(child: {
  readonly address: { readonly mode: 'one-shot' | 'continuable' }
  readonly parentAvailable?: boolean | undefined
  readonly running: boolean
} | undefined): SubagentReadOnlyMatch | null {
  if (child === undefined) return null
  if (child.address.mode === 'one-shot') return { reason: 'one-shot' }
  if (child.parentAvailable !== false) return null
  return child.running ? null : { reason: 'parent-unavailable' }
}

/** One Session row the descendant fold reads. */
export interface NativeSubagentLineageEntry {
  /** This Session's identity. */
  readonly id: string
  /** Parent identity, set for subagent descendants. */
  readonly parentId?: string | undefined
  /** Set to `subagent` for Sessions created as subagent descendants. */
  readonly origin?: 'subagent' | undefined
  /** Whether this descendant is currently running. */
  readonly running: boolean
}

/**
 * Index subagent descendants under each ancestor, for the header count.
 * @param entries - every Session row the caller holds.
 * @returns descendant totals keyed by possible parent id.
 */
export function nativeSubagentDescendants(
  entries: readonly NativeSubagentLineageEntry[],
): ReadonlyMap<string, SubagentDescendantSummary> {
  const summaries: Record<string, NativeSubagentLineageEntry> = {}
  for (const entry of entries) summaries[entry.id] = entry
  return indexSubagentDescendants(summaries as unknown as Parameters<typeof indexSubagentDescendants>[0])
}

/**
 * Compose the `subagent` namespace translator from the shipped dictionaries.
 * @param locale - active language.
 * @returns a translator with the same fallback ladder as the locale service.
 */
function translate(locale: 'en' | 'zh'): TranslateNS<typeof NS> {
  const dictionary: Record<string, string> = locale === 'zh' ? { ...commonZh, ...zh } : { ...commonEn, ...en }
  return (key, params) => formatLocaleTemplate(dictionary[key as SubagentKey] ?? key, params)
}

/**
 * Declared face of the shared composer notice, narrowed to the members it
 * reads. The original types against the chain slot's runtime props share,
 * which a Native host supplies directly.
 */
type ReadOnlyComposerComponent = (props: {
  matched: SubagentReadOnlyMatch
  t: TranslateNS<typeof NS>
}) => ReactElement

const Composer = SubagentReadOnlyComposer as unknown as ReadOnlyComposerComponent

/**
 * Explain why the normal composer is unavailable for an addressed child.
 * @param props - the selector's reason and an explicit locale.
 * @returns the read-only composer replacement.
 */
export function NativeSubagentReadOnlyComposer({ matched, locale }: NativeSubagentReadOnlyComposerProps): ReactElement {
  return <Composer matched={matched} t={translate(locale)} />
}
