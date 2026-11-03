/**
 * Cordis-free deliverable surfaces for Native Client consumers.
 *
 * The Cordis half owns three jobs: the turn-tail row (produced files plus
 * declared files), the `present` keyed toolview, and the `chatFileMentions`
 * service. The first two read only Session facts a Native host already holds,
 * so they port as pure components. The third is a prose-link provider the
 * chat view reaches through `ctx.get`, which has no Native counterpart; a
 * Native transcript links the same paths directly and needs no service.
 *
 * Everything below the data source is shared with the Cordis renderers: the
 * same chips, the same disclosure, the same file cards and copy.
 */
import type { TranslateNS } from '@redspark/rsh-client-ui-slots'
import type { ReactElement } from 'react'
import { en as commonEn, formatLocaleTemplate, zh as commonZh } from '@redspark/rsh-client-locale/dictionary'
import { PresentRow } from './client/PresentRow.tsx'
import { PresentedFileCard } from './client/PresentedFileCard.tsx'
import { ProducedFiles } from './client/ProducedFiles.tsx'
import type { PresentedOpenPhase } from './client/present-open.ts'
import type { PresentedPath } from './client/turn-deliverables.ts'
import { en, NS, zh, type DeliverablesKey } from './client/locales.ts'
import type { PresentedAction, PresentedHost } from './presented.ts'
import type { ToolCallViewProps } from '@redspark/rsh-client-ui-tool/client'

export { NS, en, zh, type DeliverablesKey } from './client/locales.ts'
export type { PresentedOpenPhase } from './client/present-open.ts'
export type { PresentedPath } from './client/turn-deliverables.ts'
export type { PresentedAction, PresentedHost } from './presented.ts'
export type { ToolCallBlock, ToolResultNode, RunningToolCall } from '@redspark/rsh-client-ui-tool/native'

/** Props of the changed-files row: selector-matched paths arrive from the caller. */
export interface NativeProducedFilesProps {
  /** Workspace-relative paths this turn changed; an empty list renders nothing. */
  readonly matched: readonly string[]
  /** Open one produced path in the Native transcript's file surface. */
  readonly openFile: (path: string) => void
  /** Locale for the row's copy, so no locale service is required. */
  readonly locale: 'en' | 'zh'
}

/** Props of the `present` tool row: the tool slice arrives from the caller. */
export interface NativePresentRowProps {
  /** Frozen running call or settled result node, as logged by the Host. */
  readonly block: ToolCallViewProps['block']
  /** Locale for the row's copy, so no locale service is required. */
  readonly locale: 'en' | 'zh'
  /** Inspect this call in the trajectory view when the caller has one. */
  readonly inspect?: (() => void) | undefined
}

/** Props of one delivered-file card: every Host fact arrives from the caller. */
export interface NativePresentedFileCardProps {
  /** Durable file identity and metadata from the delivery event. */
  readonly file: PresentedPath
  /** Session workspace root used to resolve the card's title. */
  readonly cwd: string | undefined
  /** Latest explicit open gesture for this file, when one is pending or settled. */
  readonly phase: PresentedOpenPhase | undefined
  /** Serving desktop capabilities, or `null` while they are still being read. */
  readonly host: PresentedHost | null
  /** Preview this file in the Native file surface. */
  readonly onPreview: () => void
  /** Open in the default application or reveal it in the file manager. */
  readonly onAction: (action: PresentedAction) => void
  /** Locale for the card's copy, so no locale service is required. */
  readonly locale: 'en' | 'zh'
}

/**
 * Compose the `deliverables` namespace translator from the shipped dictionaries.
 * @param locale - active language.
 * @returns a translator with the same fallback ladder as the locale service.
 */
function translate(locale: 'en' | 'zh'): TranslateNS<typeof NS> {
  const dictionary: Record<string, string> = locale === 'zh' ? { ...commonZh, ...zh } : { ...commonEn, ...en }
  return (key, params) => formatLocaleTemplate(dictionary[key as DeliverablesKey] ?? key, params)
}

/**
 * Declared faces of the shared components, narrowed to the members each one
 * reads. The originals type against the full slot-runtime props share, which
 * carries the chat-origin call-owner currency and the locale seat; a Native
 * host supplies the same data directly.
 */
type ProducedFilesComponent = (props: {
  matched: readonly string[]
  openFile: (path: string) => void
  t: TranslateNS<typeof NS>
}) => ReactElement

type PresentRowComponent = (props: {
  block: ToolCallViewProps['block']
  inspect?: (() => void) | undefined
  t: TranslateNS<typeof NS>
}) => ReactElement

type PresentedFileCardComponent = (props: {
  file: PresentedPath
  cwd: string | undefined
  phase: PresentedOpenPhase | undefined
  host: PresentedHost | null
  onPreview: () => void
  onAction: (action: PresentedAction) => void
  t: TranslateNS<typeof NS>
}) => ReactElement

const Produced = ProducedFiles as unknown as ProducedFilesComponent
const Present = PresentRow as unknown as PresentRowComponent
const FileCard = PresentedFileCard as unknown as PresentedFileCardComponent

/**
 * Render one turn's produced files as openable chips.
 * @param props - changed paths, the caller's file opener, and an explicit locale.
 * @returns the produced-files row.
 */
export function NativeProducedFiles({ matched, openFile, locale }: NativeProducedFilesProps): ReactElement {
  return <Produced matched={matched} openFile={openFile} t={translate(locale)} />
}

/**
 * Render a `present` call using its recorded arguments and result.
 * @param props - the durable call slice, an explicit locale, and an optional inspect action.
 * @returns the present tool row.
 */
export function NativePresentRow({ block, locale, inspect }: NativePresentRowProps): ReactElement {
  const t = translate(locale)
  return <Present block={block} t={t} {...inspect === undefined ? {} : { inspect }} />
}

/**
 * Render one delivered file with its preview and native-open actions.
 * @param props - durable file facts, desktop capabilities, callbacks and an explicit locale.
 * @returns the delivered-file card.
 */
export function NativePresentedFileCard({ locale, ...card }: NativePresentedFileCardProps): ReactElement {
  return <FileCard {...card} t={translate(locale)} />
}
