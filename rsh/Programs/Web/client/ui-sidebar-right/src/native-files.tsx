/** Native workspace tree and preview over the optional Session file client. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { NativeWorkspaceFilesClient } from '@deepseek-ai/dsh-client-native-session/native'
import {
  Button, IconRefreshOutline16, SidebarPathBar,
  WorkspaceCodePreview, WorkspaceFileTreeRows, WorkspaceHtmlPreview, WorkspaceImagePreview,
  WorkspaceMarkdownPreview, classifyFileType, htmlRelativePath, isCodeFileType, languageForPath,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels, ReadHtmlRelative, WorkspaceFileTreeLevel } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import css from './native-files.module.css'

type FilesTranslate = TranslateNS<'nativeSidebarRight'>
type PreviewFormat = 'code' | 'html' | 'image' | 'markdown' | 'pdf' | 'text'

type FileTreeState = {
  readonly expanded: readonly string[]
  readonly levels: Readonly<Record<string, WorkspaceFileTreeLevel>>
}

type FilePreviewState =
  | { readonly kind: 'loading'; readonly path: string }
  | { readonly kind: 'failed'; readonly path: string }
  | {
    readonly kind: 'text'
    readonly path: string
    readonly format: 'code' | 'markdown' | 'text'
    readonly absolutePath: string
    readonly version: string
    readonly text: string
    readonly lines: number
    readonly eof: boolean
    readonly loadingMore?: boolean
    readonly failure?: boolean
  }
  | {
    readonly kind: 'bytes'
    readonly path: string
    readonly format: 'html' | 'image' | 'pdf'
    readonly absolutePath: string
    readonly version: string
    readonly data: Uint8Array<ArrayBuffer>
  }

type PreviewRead = {
  readonly controller: AbortController
  readonly sessionId: SessionId
  readonly path: string
  readonly files: Map<string, string | undefined>
  readonly observations: Map<string, string | undefined>
  readonly invalidate: () => void
  pending: number
  retryOnObservation: boolean
  htmlVersion?: string
}

// File identity arrives with the response; retain observations only while a
// read is pending so a newer observation cannot be lost before that identity.
async function readPreviewFile<T extends { readonly absolutePath: string; readonly version: string }>(
  read: PreviewRead, signal: AbortSignal, operation: () => Promise<T>,
): Promise<T> {
  read.pending += 1
  try {
    const result = await operation()
    if (!signal.aborted) {
      read.files.set(result.absolutePath, result.version)
      if (read.observations.has(result.absolutePath) && read.observations.get(result.absolutePath) !== result.version) {
        read.files.set(result.absolutePath, read.observations.get(result.absolutePath))
        read.invalidate()
      }
    }
    return result
  } catch (error) {
    if (!signal.aborted) read.retryOnObservation = true
    throw error
  } finally {
    read.pending -= 1
    if (read.pending === 0) read.observations.clear()
  }
}

/** Props for the Native file panel. */
export interface NativeFilesPanelProps {
  readonly sessionId: SessionId | undefined
  readonly workspaceRoot: string | undefined
  readonly section: 'overview' | 'activity' | 'files' | 'preview'
  readonly service: NativeWorkspaceFilesClient
  readonly onOpenPreview: () => void
  readonly t: FilesTranslate
}

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0))
}

function formatOf(path: string): PreviewFormat {
  const kind = classifyFileType(path)
  if (kind === 'html') return 'html'
  if (kind === 'image') return 'image'
  if (kind === 'pdf') return 'pdf'
  if (kind === 'markdown') return 'markdown'
  if (isCodeFileType(kind) || languageForPath(path) !== undefined) return 'code'
  return 'text'
}

/** Keep one preview Blob URL alive only while its byte result is displayed. */
function PdfPreview({ data, title }: { readonly data: Uint8Array<ArrayBuffer>; readonly title: string }): ReactNode {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
    setUrl(next)
    return () => { URL.revokeObjectURL(next) }
  }, [data])
  return url === undefined
    ? <p className={css.status}>{title}</p>
    : <iframe className={css.binaryFrame} src={url} title={title} data-pdf-preview />
}

/**
 * Display text, Markdown, code, HTML, image, or PDF bytes from one Session file.
 * @param props - the selected Session, workspace service, section, and localized labels.
 * @returns the Session file tree and preview panes.
 */
export function NativeFilesPanel({
  sessionId, workspaceRoot, section, service, onOpenPreview, t,
}: NativeFilesPanelProps): ReactNode {
  const active = section === 'files' || section === 'preview'
  const previewActive = section === 'preview'
  const [tree, setTree] = useState<FileTreeState>({ expanded: [], levels: {} })
  const treeRef = useRef(tree)
  treeRef.current = tree
  const generations = useRef(new Map<string, number>())
  const controller = useRef<AbortController>()
  const [selectedPath, setSelectedPath] = useState<string>()
  const [preview, setPreview] = useState<FilePreviewState>()
  const previewRead = useRef<PreviewRead>()
  const [previewRevision, setPreviewRevision] = useState(0)
  const [followFailed, setFollowFailed] = useState(false)

  const loadDirectory = useCallback((path: string, signal: AbortSignal): void => {
    if (sessionId === undefined) return
    const generation = (generations.current.get(path) ?? 0) + 1
    generations.current.set(path, generation)
    setTree(current => ({
      ...current,
      levels: { ...current.levels, [path]: { kind: 'loading' } },
    }))
    void service.list(sessionId, path, signal).then(
      (listing) => {
        if (signal.aborted || generations.current.get(path) !== generation) return
        setTree(current => ({
          ...current,
          levels: {
            ...current.levels,
            [path]: { kind: 'ready', entries: listing.entries, truncated: listing.truncated },
          },
        }))
      },
      () => {
        if (signal.aborted || generations.current.get(path) !== generation) return
        setTree(current => ({
          ...current,
          levels: { ...current.levels, [path]: { kind: 'failed', message: t('filesUnavailable') } },
        }))
      },
    )
  }, [service, sessionId, t])

  useEffect(() => {
    if (!active || sessionId === undefined || workspaceRoot === undefined) return undefined
    const lifetime = new AbortController()
    controller.current = lifetime
    generations.current.clear()
    setTree({ expanded: ['.'], levels: { '.': { kind: 'loading' } } })
    loadDirectory('.', lifetime.signal)
    return () => {
      lifetime.abort()
      if (controller.current === lifetime) controller.current = undefined
    }
  }, [active, loadDirectory, sessionId, workspaceRoot])

  useEffect(() => {
    if (!active || sessionId === undefined || workspaceRoot === undefined) return undefined
    const watch = new AbortController()
    setFollowFailed(false)
    void (async () => {
      try {
        for await (const frame of service.follow(sessionId, watch.signal)) {
          if (frame.kind !== 'change') continue
          for (const path of treeRef.current.expanded) loadDirectory(path, watch.signal)
          const read = previewRead.current
          if (read === undefined || read.controller.signal.aborted || read.sessionId !== sessionId || read.path !== selectedPath) continue
          const { absolutePath } = frame.change
          const version = 'version' in frame.change ? frame.change.version : undefined
          // Failed reads provide no resolved identity. A new present-file
          // observation can make the preview usable; matching known reads and
          // absence observations must not retry their own failed reads.
          if (read.retryOnObservation && version !== undefined && !read.files.has(absolutePath)) {
            read.invalidate()
            continue
          }
          if (read.pending > 0) read.observations.set(absolutePath, version)
          if (read.files.has(absolutePath) && read.files.get(absolutePath) !== version) {
            read.files.set(absolutePath, version)
            read.invalidate()
          }
        }
      } catch {
        if (!watch.signal.aborted) setFollowFailed(true)
      }
    })()
    return () => { watch.abort() }
  }, [active, loadDirectory, selectedPath, service, sessionId, workspaceRoot])

  useEffect(() => {
    if (!previewActive || sessionId === undefined || selectedPath === undefined) return undefined
    const controller = new AbortController()
    // Keep dependency identities across retries of the same document, including
    // removed assets whose recreation can make a failed HTML pack usable again.
    const previous = previewRead.current
    const sameFile = previous?.sessionId === sessionId && previous.path === selectedPath
    const read: PreviewRead = {
      controller, sessionId, path: selectedPath,
      files: new Map(sameFile ? previous.files : undefined), observations: new Map(), pending: 0, retryOnObservation: false,
      ...sameFile && previous.htmlVersion !== undefined ? { htmlVersion: previous.htmlVersion } : {},
      invalidate: () => {
        if (controller.signal.aborted) return
        controller.abort()
        setPreviewRevision(value => value + 1)
      },
    }
    previewRead.current = read
    setPreview({ kind: 'loading', path: selectedPath })
    const format = formatOf(selectedPath)
    void (async () => {
      if (format === 'html' || format === 'image' || format === 'pdf') {
        const result = await readPreviewFile(read, controller.signal, () => service.readAll(sessionId, selectedPath, controller.signal))
        if (format === 'html' && read.htmlVersion !== result.version) {
          read.files.clear()
          read.files.set(result.absolutePath, result.version)
          read.htmlVersion = result.version
        }
        return {
          kind: 'bytes' as const,
          path: selectedPath,
          format,
          absolutePath: result.absolutePath,
          version: result.version,
          data: bytesOf(result.data),
        }
      }
      const result = await readPreviewFile(read, controller.signal,
        () => service.read(sessionId, selectedPath, { offset: 1 }, controller.signal))
      return {
        kind: 'text' as const,
        path: selectedPath,
        format,
        absolutePath: result.absolutePath,
        version: result.version,
        text: result.text,
        lines: result.lines,
        eof: result.eof,
      }
    })().then(
      (result) => {
        if (!controller.signal.aborted) setPreview(result)
      },
      () => { if (!controller.signal.aborted) setPreview({ kind: 'failed', path: selectedPath }) },
    )
    return () => {
      controller.abort()
    }
  }, [previewActive, previewRevision, selectedPath, service, sessionId])

  const toggleDirectory = (path: string): void => {
    const expanded = tree.expanded.includes(path)
    setTree(current => ({
      ...current,
      expanded: expanded ? current.expanded.filter(item => item !== path) : [...current.expanded, path],
    }))
    const signal = controller.current?.signal
    if (!expanded && signal !== undefined) loadDirectory(path, signal)
  }

  const reloadTree = (): void => {
    const signal = controller.current?.signal
    if (signal === undefined) return
    for (const path of tree.expanded) loadDirectory(path, signal)
  }

  const loadMore = (): void => {
    if (preview?.kind !== 'text' || preview.loadingMore || preview.eof || sessionId === undefined) return
    const signal = previewRead.current?.controller.signal
    if (signal === undefined) return
    const current = preview
    setPreview({ ...current, loadingMore: true, failure: false })
    void service.read(sessionId, current.path, { offset: current.lines + 1 }, signal).then(
      (result) => {
        if (signal.aborted) return
        setPreview(value => value?.kind !== 'text' || value.path !== current.path ? value : {
          ...value,
          text: value.lines > 0 && result.lines > 0 ? `${value.text}\n${result.text}` : value.text + result.text,
          lines: value.lines + result.lines,
          eof: result.eof,
          absolutePath: result.absolutePath,
          loadingMore: false,
        })
      },
      () => {
        if (!signal.aborted) setPreview(value => value?.kind !== 'text' || value.path !== current.path
          ? value : { ...value, loadingMore: false, failure: true })
      },
    )
  }

  const readRelated = useCallback<ReadHtmlRelative>(async (reference, signal) => {
    if (sessionId === undefined || selectedPath === undefined) throw new Error('No file is selected')
    const path = htmlRelativePath(reference)
    const read = previewRead.current
    if (read === undefined || read.sessionId !== sessionId || read.path !== selectedPath) throw new Error('No preview read is active')
    const lifetime = AbortSignal.any([signal, read.controller.signal])
    lifetime.throwIfAborted()
    const result = await readPreviewFile(read, lifetime, () => service.readRelated(sessionId, selectedPath, path, lifetime))
    return bytesOf(result.data)
  }, [selectedPath, service, sessionId])

  const markdownLabels: MarkdownLabels = {
    code: { copyLabel: t('fileCopy'), copiedLabel: t('fileCopied') },
    footnotes: t('fileFootnotes'),
  }
  const current = preview?.path === selectedPath ? preview : undefined
  return <div className={`${css.panel} ${active ? '' : css.hidden}`}>
    <div className={`${css.pane} ${section === 'files' ? '' : css.hidden}`}>
      <SidebarPathBar path={workspaceRoot ?? t('noWorkspace')}>
        <button type="button" className={css.tool} aria-label={t('reloadFiles')} title={t('reloadFiles')}
          onClick={reloadTree}><IconRefreshOutline16 /></button>
      </SidebarPathBar>
      {followFailed && <p className={css.watchNote}>{t('fileFollowUnavailable')}</p>}
      {workspaceRoot === undefined
        ? <p className={css.status}>{t('noWorkspace')}</p>
        : <div className={css.treeBody}>
          <WorkspaceFileTreeRows
            root="."
            expanded={tree.expanded}
            levels={tree.levels}
            labels={{ loading: t('filesLoading'), empty: t('filesEmpty'), truncated: t('filesTruncated'), other: t('filesOther') }}
            onToggle={toggleDirectory}
            onOpen={(path) => {
              setSelectedPath(path)
              setPreviewRevision(value => value + 1)
              onOpenPreview()
            }}
          />
        </div>}
    </div>
    <div className={`${css.pane} ${section === 'preview' ? '' : css.hidden}`}>
      <SidebarPathBar path={current?.kind === 'text' || current?.kind === 'bytes'
        ? current.absolutePath : selectedPath ?? t('filePreview')}>
        {selectedPath !== undefined && <button type="button" className={css.tool} aria-label={t('reloadPreview')}
          title={t('reloadPreview')} onClick={() => { setPreviewRevision(value => value + 1) }}>
          <IconRefreshOutline16 />
        </button>}
      </SidebarPathBar>
      {followFailed && <p className={css.watchNote}>{t('fileFollowUnavailable')}</p>}
      {selectedPath === undefined
        ? <p className={css.status}>{t('chooseFile')}</p>
        : current === undefined || current.kind === 'loading'
          ? <p className={css.status}>{t('fileLoading')}</p>
          : current.kind === 'failed'
            ? <p className={css.status} role="alert">{t('fileUnavailable')}</p>
            : current.kind === 'bytes'
              ? current.format === 'html'
                ? <WorkspaceHtmlPreview data={current.data} readRelative={readRelated} labels={{
                  loading: t('fileLoading'), failed: t('fileUnavailable'), frame: t('htmlPreview'),
                }} />
                : current.format === 'image'
                  ? <WorkspaceImagePreview path={current.path} data={current.data} labels={{
                    loading: t('fileLoading'), failed: t('fileUnavailable'), unsupported: t('fileUnsupported'),
                    preview: name => t('imagePreview', { name }),
                  }} />
                  : <PdfPreview data={current.data} title={t('pdfPreview')} />
              : <div className={css.textPanel}>
                {current.format === 'markdown'
                  ? <WorkspaceMarkdownPreview text={current.text} eof={current.eof} labels={markdownLabels} />
                  : current.format === 'code'
                    ? <WorkspaceCodePreview path={current.path} text={current.text} eof={current.eof} wrap={false}
                      copyLabel={t('fileCopy')} copiedLabel={t('fileCopied')} />
                    : <pre className={css.plainText}>{current.text}</pre>}
                {!current.eof && <div className={css.more}>
                  {current.failure && <span role="alert">{t('fileUnavailable')}</span>}
                  <Button variant="ghost" size="sm" disabled={current.loadingMore} onClick={loadMore}>
                    {current.loadingMore ? t('fileLoading') : t('loadMore')}
                  </Button>
                </div>}
              </div>}
    </div>
  </div>
}
