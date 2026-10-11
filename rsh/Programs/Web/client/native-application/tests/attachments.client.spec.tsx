// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { NativeModelControls, NativeSessionImage } from '@deepseek-ai/dsh-client-native-session/native'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeComposerAttachments, NativeMessageImage } from '../src/attachments.tsx'

const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')

afterEach(() => {
  if (originalCreateObjectURL === undefined) Reflect.deleteProperty(URL, 'createObjectURL')
  else Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL)
  if (originalRevokeObjectURL === undefined) Reflect.deleteProperty(URL, 'revokeObjectURL')
  else Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL)
})

const limits: NonNullable<NativeModelControls['images']> = {
  mediaTypes: ['image/png', 'image/jpeg'],
  maxImagesPerMessage: 2,
  maxImageBytes: 4,
  maxMessageImageBytes: 3,
  maxImagePixels: 1000,
  maxImageDimension: 1000,
}

const messages: Record<string, string> = {
  images: 'Add images',
  image: 'Image',
  imageLoading: 'Loading image…',
  imageLoadFailed: 'Image failed to load; retry',
  imageOpenOriginal: 'Open original image',
  imageOpenOriginalNamed: 'Open original image: {label}',
  imagePreview: 'Image preview',
  imageClosePreview: 'Close image preview',
  imageRemove: 'Remove image {name}',
  attachmentPending: 'Pending attachments',
  attachmentScrollLeft: 'Scroll attachments left',
  attachmentScrollRight: 'Scroll attachments right',
  attachmentDropTitle: 'Drop images here',
  attachmentDropBlocked: 'Images cannot be added right now',
  attachmentDropDescription: 'Up to {count} images, {size} each',
  attachmentRejectedType: 'Unsupported image type.',
  attachmentRejectedImageSize: 'Image exceeds the per-image limit.',
  attachmentRejectedCount: 'Image count limit reached.',
  attachmentRejectedMessageSize: 'Images exceed the message size limit.',
  filePending: 'Pending file {name}',
  fileRemove: 'Remove file {name}',
  fileUploading: 'Uploading',
  fileUploadFailed: 'Upload failed',
  fileRetry: 'Retry upload for {name}',
}

const translate = ((key: string, params?: Record<string, unknown>) =>
  (messages[key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params?.[name]
    return typeof value === 'string' ? value : typeof value === 'number' ? `${value}` : ''
  })
) as Parameters<typeof NativeComposerAttachments>[0]['t']

function fileDrag(type: 'dragenter' | 'drop', files: readonly File[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files } })
  return event
}

it('filters picked and dropped files by limits and opens a loaded Session image', async () => {
  let urlSequence = 0
  const createObjectURL = vi.fn(() => `blob:test-${String(++urlSequence)}`)
  const revokeObjectURL = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
  let files: readonly File[] = []
  const first = new File(['aa'], 'first.png', { type: 'image/png' })
  const overBatch = new File(['bb'], 'batch.png', { type: 'image/png' })
  const unsupported = new File(['x'], 'note.txt', { type: 'text/plain' })
  const oversized = new File(['12345'], 'large.png', { type: 'image/png' })
  const second = new File(['b'], 'second.jpg', { type: 'image/jpeg' })
  const countOverflow = new File(['c'], 'third.jpg', { type: 'image/jpeg' })
  let rerenderAttachments = (): void => {}
  const attachmentView = render(<NativeComposerAttachments
    files={files}
    onChange={(next) => { files = next; rerenderAttachments() }}
    limits={limits}
    disabled={false}
    t={translate}
  />)
  rerenderAttachments = () => { attachmentView.rerender(<NativeComposerAttachments
    files={files}
    onChange={(next) => { files = next; rerenderAttachments() }}
    limits={limits}
    disabled={false}
    t={translate}
  />) }

  const input = screen.getByLabelText('Add images')
  fireEvent.change(input, { target: { files: [first, overBatch, unsupported, oversized, second, countOverflow] } })
  expect(files).toEqual([first, second])
  expect(screen.getByText('Unsupported image type.')).toBeTruthy()
  expect(screen.getByText('Image exceeds the per-image limit.')).toBeTruthy()
  expect(screen.getByText('Images exceed the message size limit.')).toBeTruthy()
  expect(screen.getByText('Image count limit reached.')).toBeTruthy()

  fireEvent(document, fileDrag('dragenter', [countOverflow]))
  expect(screen.getByText('Drop images here')).toBeTruthy()
  fireEvent(document, fileDrag('drop', [countOverflow]))
  await waitFor(() => { expect(screen.getAllByText('Image count limit reached.')).toHaveLength(1) })

  attachmentView.unmount()
  const image = { attachmentId: 'image-1', name: 'saved.png', width: 80, height: 60 } as NativeSessionImage
  const loadImage = vi.fn(async () => new Blob(['image'], { type: 'image/png' }))
  render(<NativeMessageImage
    image={image}
    sessionId={'session-1' as SessionId}
    loadImage={loadImage}
    t={translate}
  />)
  fireEvent.click(await screen.findByRole('button', { name: 'Open original image: saved.png' }))
  expect(await screen.findByRole('dialog', { name: 'Image preview' })).toBeTruthy()
  expect(loadImage).toHaveBeenCalledWith('session-1', image, expect.any(AbortSignal))
  expect(createObjectURL).toHaveBeenCalledTimes(3)
})
