/** Props-only document presentations shared by legacy and Native workspace readers. */
import { useEffect, useState, type ReactNode, type Ref } from 'react'
import { CodeBlock } from './markdown/CodeBlock.tsx'
import { MarkdownText } from './markdown/MarkdownText.tsx'
import type { MarkdownLabels } from './markdown/MarkdownText.tsx'
import { pathPartsOf } from '@deepseek-ai/dsh-util-workspace-path'
import { LoadingIndicator } from './LoadingIndicator.tsx'
import { createWorkspaceHtmlDocument, packWorkspaceHtml } from './workspace-html.ts'
import type { ReadHtmlRelative } from './workspace-html.ts'
import { languageForPath } from './workspace-code-languages.ts'
import codeCss from './WorkspaceCodePreview.module.css'
import markdownCss from './WorkspaceMarkdownPreview.module.css'
import htmlCss from './WorkspaceHtmlPreview.module.css'
import imageCss from './WorkspaceImagePreview.module.css'

/** Props for {@link WorkspaceCodePreview}. */
export interface WorkspaceCodePreviewProps {
  readonly path: string
  readonly text: string
  readonly eof: boolean
  readonly wrap: boolean
  readonly copyLabel: string
  readonly copiedLabel: string
  readonly contentRef?: Ref<HTMLDivElement>
}

/**
 * Render source with the shared language map and highlighted CodeBlock.
 * @param props - file path, accumulated source, and localized copy labels.
 * @returns highlighted source with line numbers.
 */
export function WorkspaceCodePreview({
  path, text, eof, wrap, copyLabel, copiedLabel, contentRef,
}: WorkspaceCodePreviewProps): ReactNode {
  return <div className={codeCss.renderer} data-code-preview data-wrap={wrap}>
    <CodeBlock className={codeCss.code} contentRef={contentRef} code={text} lang={languageForPath(path)}
      streaming={!eof} lineNumbers copyLabel={copyLabel} copiedLabel={copiedLabel} />
  </div>
}

/** Props for {@link WorkspaceMarkdownPreview}. */
export interface WorkspaceMarkdownPreviewProps {
  readonly text: string
  readonly eof: boolean
  readonly labels: MarkdownLabels
}

/**
 * Render accumulated Markdown with the shared untrusted Markdown pipeline.
 * @param props - accumulated Markdown source and localized renderer labels.
 * @returns the shared Markdown document presentation.
 */
export function WorkspaceMarkdownPreview({ text, eof, labels }: WorkspaceMarkdownPreviewProps): ReactNode {
  return <div className={markdownCss.document} data-document-markdown>
    <MarkdownText text={text} streaming={!eof} labels={labels} />
  </div>
}

/** Props for {@link WorkspaceHtmlPreview}. */
export interface WorkspaceHtmlPreviewProps {
  readonly data: Uint8Array<ArrayBuffer>
  readonly readRelative: ReadHtmlRelative
  readonly labels: { readonly loading: string; readonly failed: string; readonly frame: string }
}

type HtmlFrameState = Pick<WorkspaceHtmlPreviewProps, 'data' | 'readRelative'> & { readonly url: string | undefined }

/**
 * Prepare bounded HTML assets and render them in a script-enabled opaque iframe.
 * @param props - complete HTML bytes, the Session file reader, and localized labels.
 * @returns a sandboxed iframe or its loading/failure status.
 */
export function WorkspaceHtmlPreview({ data, readRelative, labels }: WorkspaceHtmlPreviewProps): ReactNode {
  const [frame, setFrame] = useState<HtmlFrameState>()
  useEffect(() => {
    const controller = new AbortController()
    let url: string | undefined
    void (async () => {
      try {
        const bundle = await packWorkspaceHtml(data, readRelative, controller.signal)
        controller.signal.throwIfAborted()
        url = URL.createObjectURL(new Blob([createWorkspaceHtmlDocument(bundle)], { type: 'text/html' }))
        setFrame({ data, readRelative, url })
      } catch {
        if (!controller.signal.aborted) setFrame({ data, readRelative, url: undefined })
      }
    })()
    return () => {
      controller.abort()
      if (url !== undefined) URL.revokeObjectURL(url)
    }
  }, [data, readRelative])
  if (frame?.data !== data || frame.readRelative !== readRelative) {
    return <LoadingIndicator className={htmlCss.status} label={labels.loading} />
  }
  if (frame.url === undefined) return <p className={htmlCss.status} role="alert">{labels.failed}</p>
  return <iframe key={frame.url} className={htmlCss.frame} src={frame.url} sandbox="allow-scripts"
    title={labels.frame} data-html-preview />
}

/** Supported image suffixes and Blob media types. */
const IMAGE_MEDIA_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml',
} as const
type ImageMediaType = typeof IMAGE_MEDIA_TYPES[keyof typeof IMAGE_MEDIA_TYPES]

/**
 * Resolve a supported image suffix to its Blob media type.
 * @param path - workspace file path.
 * @returns the supported image media type, or undefined.
 */
export function workspaceImageMediaType(path: string): ImageMediaType | undefined {
  const normalized = path.replaceAll('\\', '/')
  const name = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase()
  const extension = name.slice(name.lastIndexOf('.') + 1) as keyof typeof IMAGE_MEDIA_TYPES
  return IMAGE_MEDIA_TYPES[extension]
}

/** Props for {@link WorkspaceImagePreview}. */
export interface WorkspaceImagePreviewProps {
  readonly path: string
  readonly data: Uint8Array<ArrayBuffer> | undefined
  readonly labels: {
    readonly loading: string
    readonly failed: string
    readonly unsupported: string
    readonly preview: (name: string) => string
  }
}

type ImageSource =
  | { readonly kind: 'ready'; readonly data: Uint8Array<ArrayBuffer>; readonly mediaType: ImageMediaType; readonly url: string }
  | { readonly kind: 'failed'; readonly data: Uint8Array<ArrayBuffer>; readonly mediaType: ImageMediaType }

/**
 * Render complete image bytes at their intrinsic CSS-pixel dimensions.
 * @param props - file path, complete bytes, and localized status labels.
 * @returns an intrinsic-size image or its loading/failure status.
 */
export function WorkspaceImagePreview({ path, data, labels }: WorkspaceImagePreviewProps): ReactNode {
  const mediaType = workspaceImageMediaType(path)
  const [source, setSource] = useState<ImageSource>()
  useEffect(() => {
    if (data === undefined || mediaType === undefined) return
    let url: string | undefined
    try {
      url = URL.createObjectURL(new Blob([data], { type: mediaType }))
      setSource({ kind: 'ready', data, mediaType, url })
    } catch {
      setSource({ kind: 'failed', data, mediaType })
    }
    return () => { if (url !== undefined) URL.revokeObjectURL(url) }
  }, [data, mediaType])
  if (data === undefined || mediaType === undefined) return <p className={imageCss.status} role="alert">{labels.unsupported}</p>
  if (source?.data !== data || source.mediaType !== mediaType) {
    return <LoadingIndicator className={imageCss.status} label={labels.loading} />
  }
  if (source.kind === 'failed') return <p className={imageCss.status} role="alert">{labels.failed}</p>
  const { name } = pathPartsOf(path)
  return <LoadedWorkspaceImage key={source.url} url={source.url} name={name} labels={labels} />
}

function LoadedWorkspaceImage({ url, name, labels }: {
  readonly url: string
  readonly name: string
  readonly labels: WorkspaceImagePreviewProps['labels']
}): ReactNode {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  return <div className={imageCss.frame} data-image-preview>
    {state === 'loading' && <LoadingIndicator className={imageCss.status} label={labels.loading} />}
    {state === 'failed' && <p className={imageCss.status} role="alert">{labels.failed}</p>}
    <img className={imageCss.image} src={url} alt={labels.preview(name)} decoding="async" draggable={false}
      referrerPolicy="no-referrer" hidden={state !== 'ready'} onLoad={() => { setState('ready') }}
      onError={() => { setState('failed') }} />
  </div>
}
