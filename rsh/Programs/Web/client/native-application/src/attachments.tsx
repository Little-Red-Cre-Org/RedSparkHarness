/** Native conversation image loading and draft-file presentation. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AttachmentRail, DropOverlay, FileCard, ImageLightbox, MessageImage } from '@deepseek-ai/dsh-client-ui-attachment/native'
import type { AttachmentRailItem, ImageLoader, MessageImageLabels } from '@deepseek-ai/dsh-client-ui-attachment/native'
import { fileSizeText, IconCloseFill14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NativeSessionImage } from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeModelControls } from '@deepseek-ai/dsh-client-native-session/native'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import css from './attachments.module.css'

type Translate = TranslateNS<'nativeApplication'>
type ImageLimits = NonNullable<NativeModelControls['images']>
type AttachmentNotice = 'attachmentRejectedType' | 'attachmentRejectedImageSize'
  | 'attachmentRejectedCount' | 'attachmentRejectedMessageSize'

interface RailFile extends AttachmentRailItem {
  readonly file: File
}

function filterFiles(files: readonly File[], limits: ImageLimits): {
  readonly accepted: readonly File[]
  readonly rejected: readonly AttachmentNotice[]
} {
  const accepted: File[] = []
  let totalBytes = 0
  const rejected = new Set<AttachmentNotice>()
  for (const file of files) {
    if (!limits.mediaTypes.includes(file.type as (typeof limits.mediaTypes)[number])) {
      rejected.add('attachmentRejectedType')
    } else if (file.size > limits.maxImageBytes) {
      rejected.add('attachmentRejectedImageSize')
    } else if (accepted.length >= limits.maxImagesPerMessage) {
      rejected.add('attachmentRejectedCount')
    } else if (totalBytes + file.size > limits.maxMessageImageBytes) {
      rejected.add('attachmentRejectedMessageSize')
    } else {
      accepted.push(file)
      totalBytes += file.size
    }
  }
  return { accepted, rejected: [...rejected] }
}

/** Recorded image rendered through the shared thumbnail and lightbox components. */
export function NativeMessageImage({ image, sessionId, loadImage, t }: {
  image: NativeSessionImage
  sessionId: SessionId
  loadImage: (sessionId: SessionId, image: NativeSessionImage, signal: AbortSignal) => Promise<Blob>
  t: Translate
}) {
  const requests = useRef(new Set<AbortController>())
  const urls = useRef(new Set<string>())
  useEffect(() => () => {
    for (const request of requests.current) request.abort()
    requests.current.clear()
    for (const url of urls.current) URL.revokeObjectURL(url)
    urls.current.clear()
  }, [image, loadImage, sessionId])
  const load = useCallback<ImageLoader>(async (attachment) => {
    const request = new AbortController()
    requests.current.add(request)
    try {
      const blob = await loadImage(sessionId, attachment, request.signal)
      if (request.signal.aborted) return ''
      const url = URL.createObjectURL(blob)
      urls.current.add(url)
      return url
    } finally {
      requests.current.delete(request)
    }
  }, [loadImage, sessionId])
  const labels: MessageImageLabels = {
    image: t('image'),
    open: t('imageOpenOriginal'),
    openNamed: label => t('imageOpenOriginalNamed', { label }),
    loading: t('imageLoading'),
    loadFailed: t('imageLoadFailed'),
    lightbox: { dialog: t('imagePreview'), close: t('imageClosePreview') },
  }
  return <MessageImage image={{ attachment: image }} load={load} variant="single" labels={labels} />
}

/** Limit-checked Native Client composer file picker, drop target and attachment rail. */
export function NativeComposerAttachments({ files, onChange, limits, disabled, t }: {
  files: readonly File[]
  onChange: (files: readonly File[]) => void
  limits: ImageLimits
  disabled: boolean
  t: Translate
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dragDepth = useRef(0)
  const [dragActive, setDragActive] = useState(false)
  const [notices, setNotices] = useState<readonly AttachmentNotice[]>([])
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const [previewUrls, setPreviewUrls] = useState<ReadonlyMap<File, string>>(new Map())
  const previousLimits = useRef(limits)
  const imageFiles = useMemo(() => files.filter(file => limits.mediaTypes.includes(
    file.type as (typeof limits.mediaTypes)[number],
  )), [files, limits.mediaTypes])

  useEffect(() => {
    const urls = new Map(imageFiles.map(file => [file, URL.createObjectURL(file)]))
    setPreviewUrls(urls)
    return () => { for (const url of urls.values()) URL.revokeObjectURL(url) }
  }, [imageFiles])

  useEffect(() => {
    if (previewFile !== null && !files.includes(previewFile)) setPreviewFile(null)
  }, [files, previewFile])

  useEffect(() => {
    if (previousLimits.current === limits) return
    previousLimits.current = limits
    const { accepted, rejected } = filterFiles(files, limits)
    if (accepted.length !== files.length) onChange(accepted)
    setNotices(rejected)
  }, [files, limits, onChange])

  const addFiles = useCallback((incoming: readonly File[]) => {
    if (disabled) return
    const { accepted, rejected } = filterFiles([...files, ...incoming], limits)
    if (accepted.length !== files.length) onChange(accepted)
    setNotices(rejected)
  }, [disabled, files, limits, onChange])

  useEffect(() => {
    const fileTransfer = (event: globalThis.DragEvent): DataTransfer | null => {
      const transfer = event.dataTransfer
      return transfer !== null && transfer.types.includes('Files') ? transfer : null
    }
    const reset = (): void => {
      dragDepth.current = 0
      setDragActive(false)
    }
    const onDragEnter = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      event.preventDefault()
      dragDepth.current += 1
      setDragActive(true)
    }
    const onDragOver = (event: globalThis.DragEvent): void => {
      const transfer = fileTransfer(event)
      if (transfer === null) return
      event.preventDefault()
      transfer.dropEffect = disabled ? 'none' : 'copy'
    }
    const onDragLeave = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragActive(false)
      const leftViewport = event.clientX <= 0 || event.clientY <= 0
        || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight
      if ((event.target === document.documentElement || event.target === document.body) && leftViewport) reset()
    }
    const onDrop = (event: globalThis.DragEvent): void => {
      const transfer = fileTransfer(event)
      if (transfer === null) return
      event.preventDefault()
      reset()
      addFiles([...transfer.files])
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    window.addEventListener('dragend', reset)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', reset)
    }
  }, [addFiles, disabled])

  const removeFile = (file: File): void => {
    if (disabled) return
    onChange(files.filter(candidate => candidate !== file))
    setNotices([])
    if (previewFile === file) setPreviewFile(null)
  }
  const railItems = useMemo<RailFile[]>(() => files.map((file, index) => ({
    id: `${String(index)}:${file.name}`,
    file,
  })), [files])
  const previewUrl = previewFile === null ? undefined : previewUrls.get(previewFile)
  const previewLabels = {
    dialog: t('imagePreview'),
    close: t('imageClosePreview'),
  }

  return <>
    {dragActive && <DropOverlay disabled={disabled} labels={{
      title: disabled ? t('attachmentDropBlocked') : t('attachmentDropTitle'),
      desc: disabled ? undefined : t('attachmentDropDescription', {
        count: limits.maxImagesPerMessage,
        size: fileSizeText(limits.maxImageBytes),
      }),
    }} />}
    <div className={css.attachments}>
      <input
        ref={inputRef}
        className={css.input}
        type="file"
        multiple
        accept={limits.mediaTypes.join(',')}
        aria-label={t('images')}
        disabled={disabled}
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []))
          event.currentTarget.value = ''
        }}
      />
      <button type="button" className={css.picker} disabled={disabled} onClick={() => { inputRef.current?.click() }}>
        {t('images')}
      </button>
      {railItems.length > 0 && <div className={css.rail}>
        <AttachmentRail
          items={railItems}
          labels={{
            group: t('attachmentPending'),
            scrollLeft: t('attachmentScrollLeft'),
            scrollRight: t('attachmentScrollRight'),
          }}
          renderItem={({ file }) => limits.mediaTypes.includes(file.type as (typeof limits.mediaTypes)[number])
            ? <div className={css.imageItem}>
              <button
                type="button"
                className={css.thumbnail}
                title={t('imageOpenOriginal')}
                aria-label={t('imageOpenOriginalNamed', { label: file.name || t('image') })}
                disabled={disabled || previewUrls.get(file) === undefined}
                onClick={() => { setPreviewFile(file) }}
              >
                {previewUrls.get(file) === undefined ? null
                  : <img src={previewUrls.get(file)} alt={file.name || t('image')} />}
              </button>
              <button
                type="button"
                className={css.remove}
                aria-label={t('imageRemove', { name: file.name || t('image') })}
                disabled={disabled}
                onClick={() => { removeFile(file) }}
              >
                <IconCloseFill14 size={12} />
              </button>
            </div>
            : <FileCard
              name={file.name || t('image')}
              bytes={file.size}
              state="ready"
              disabled={disabled}
              labels={{
                label: t('filePending', { name: file.name || t('image') }),
                remove: t('fileRemove', { name: file.name || t('image') }),
                uploading: t('fileUploading'),
                failed: t('fileUploadFailed'),
                retry: t('fileRetry', { name: file.name || t('image') }),
              }}
              onRemove={() => { removeFile(file) }}
            />}
        />
      </div>}
      {notices.length > 0 && <ul className={css.notices} role="status" aria-live="polite">
        {notices.map(notice => <li key={notice}>{t(notice)}</li>)}
      </ul>}
    </div>
    {previewUrl !== undefined && <ImageLightbox
      src={previewUrl}
      alt={previewFile?.name ?? t('image')}
      labels={previewLabels}
      onClose={() => { setPreviewFile(null) }}
    />}
  </>
}
