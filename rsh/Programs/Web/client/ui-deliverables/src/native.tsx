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
import { useEffect, useSyncExternalStore, type ReactElement } from 'react'
import { en as commonEn, formatLocaleTemplate, zh as commonZh } from '@redspark/rsh-client-locale/dictionary'
import { FileTypeIcon, fileExtension } from '@redspark/rsh-client-ui-primitives'
import { resolveWorkspacePath } from '@redspark/rsh-util-workspace-path'
import { PresentRow } from './client/PresentRow.tsx'
import { PresentedFileCard } from './client/PresentedFileCard.tsx'
import { ProducedFiles } from './client/ProducedFiles.tsx'
import { PresentedOpenController, type PresentedOpenPhase } from './client/present-open.ts'
import { en, NS, zh, type DeliverablesKey } from './client/locales.ts'
import { basename, presentedFileUrl, type PresentedAction, type PresentedHost } from './presented.ts'
import type { PresentedPath } from './fold-deliverables.ts'
import type { ToolCallBlock } from '@redspark/rsh-client-ui-tool/native'
import type { SessionId } from '@redspark/rsh-session/types'
import css from './client/Deliverables.module.css'

export { NS, en, zh, type DeliverablesKey } from './client/locales.ts'
export { PresentedOpenController } from './client/present-open.ts'
export type { PresentedOpenPhase } from './client/present-open.ts'
export type { PresentedPath } from './fold-deliverables.ts'
export type { PresentedAction, PresentedHost } from './presented.ts'
export type { ToolCallBlock, ToolResultNode, RunningToolCall } from '@redspark/rsh-client-ui-tool/native'
export { foldDeliverables, type TurnDeliverables } from './fold-deliverables.ts'

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
  readonly block: ToolCallBlock
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

/** Props of one Turn's declared-file row. */
export interface NativePresentedFilesProps {
  /** Session whose delivery events carry these files. */
  readonly sessionId: SessionId
  /** Declared files for the Turn, in event order. */
  readonly files: readonly PresentedPath[]
  /** Session workspace root used to resolve card titles. */
  readonly cwd: string | undefined
  /** Shared open-gesture status and Host capabilities. */
  readonly controller: PresentedOpenController
  /** Locale for the row's copy, so no locale service is required. */
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
  block: ToolCallBlock
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

/**
 * Render one Turn's declared files with their open and reveal gestures.
 *
 * The Native transcript has no sidebar-tab opener yet, so this row offers the
 * default-application and file-manager actions directly instead of the Cordis
 * card's sidebar preview.
 * @param props - durable file coordinates, workspace root, open controller and locale.
 * @returns the declared-file row, or null when the Turn declared nothing.
 */
export function NativePresentedFiles({ sessionId, files, cwd, controller, locale }: NativePresentedFilesProps): ReactElement | null {
  const states = useSyncExternalStore(
    onChange => controller.state.subscribe(onChange),
    () => controller.state.getSnapshot(),
  )
  const host = useSyncExternalStore(
    onChange => controller.host.subscribe(onChange),
    () => controller.host.getSnapshot(),
  )
  useEffect(() => {
    if (files.length > 0 && host === null) void controller.loadHost()
  }, [files.length, host, controller])
  if (files.length === 0) return null
  const t = translate(locale)
  const reveal = host === null || host === 'error' ? 'directory' : host.fileManager ?? 'directory'
  return <div className={css.root}>
    {host === 'error' && <div className={css.hostStatus}>
      <span>{t('presented.hostError')}</span>
      <button type="button" onClick={() => { void controller.loadHost() }}>{t('presented.retry')}</button>
    </div>}
    {host !== null && host !== 'error' && !host.available
      && <span className={css.hostStatus}>{t('presented.unavailable')}</span>}
    <div className={css.presented} data-presented-files-row data-single={files.length === 1 ? true : undefined}>
      {files.map((file) => {
        const phase = states[presentedFileUrl(sessionId, file.seq, file.index)]
        const pending = phase === 'opening' || phase === 'revealing'
        const disabled = pending || host === null || host === 'error' || !host.available
        const status = phase === undefined
          ? file.description ?? (fileExtension(basename(file.path)) || t('presented.file'))
          : t(reveal === 'directory' && phase === 'revealed' ? 'presented.directoryOpened'
            : reveal === 'directory' && phase === 'revealing' ? 'presented.directoryOpening'
              : reveal === 'directory' && phase === 'revealError' ? 'presented.directoryError'
                : `presented.${phase}`)
        return <div key={`${file.seq}:${file.index}`} className={css.file} data-presented-file>
          <span className={css.fileIcon}><FileTypeIcon path={file.path} size={20} /></span>
          <div className={css.fileBody}>
            <div className={css.details}>
              <span className={css.fileName} title={resolveWorkspacePath(cwd, file.path)}>{basename(file.path)}</span>
              <span className={css.description} role={phase === undefined ? undefined : 'status'}
                data-error={phase === 'error' || phase === 'revealError' || phase === 'nativeUnavailable' ? true : undefined}>
                {status}
              </span>
            </div>
            <div className={css.split}>
              <button type="button" className={css.open} disabled={disabled}
                aria-label={t('presented.openButton', { name: file.path })}
                onClick={() => { void controller.open(sessionId, file.seq, file.index) }}>{t('presented.action')}</button>
              <button type="button" className={css.chevron} disabled={disabled}
                aria-label={t('presented.revealButton', { name: file.path })}
                onClick={() => { void controller.open(sessionId, file.seq, file.index, 'reveal') }}>
                <span>{t(reveal === 'finder' ? 'presented.finder' : reveal === 'explorer' ? 'presented.explorer' : 'presented.directory')}</span>
              </button>
            </div>
          </div>
        </div>
      })}
    </div>
  </div>
}
