/** Wire-form admission of base64-encoded image uploads. @module @deepseek-ai/dsh-attachment/admission */

import { Buffer } from 'node:buffer'
import { AttachmentError } from './error.ts'
import type {
  AdmittedPromptContentPart,
  AttachmentAdmissionPart,
  ImageAttachmentLimits,
  EncodedFileAttachment,
  EncodedImageAttachment,
  FileAttachmentRef,
  ImageAttachmentRef,
  SaveImageAttachment,
  SaveFileAttachment,
} from './types.ts'

/** Image-batch operation needed to admit wire uploads. */
export interface ImageBatchStore {
  /**
   * @param inputs - decoded images in message order.
   * @returns durable references in the same order.
   */
  saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]>
}

/** Verbatim file operation needed to admit a wire upload. */
export interface FileSaveStore {
  /**
   * @param input - decoded file bytes.
   * @returns its durable reference.
   */
  saveFile(input: SaveFileAttachment): Promise<FileAttachmentRef>
}

/** Decode one upload payload while rejecting non-canonical base64 forms. */
function decodeCanonicalBase64(data: string, empty: 'reject' | 'accept', code: 'INVALID_IMAGE_BASE64' | 'INVALID_FILE_BASE64'): Uint8Array {
  const decoded = Buffer.from(data, 'base64')
  if ((data.length === 0 && empty === 'reject') || decoded.toString('base64') !== data) {
    throw new AttachmentError(
      code === 'INVALID_IMAGE_BASE64' ? 'Image upload is not canonical base64.' : 'File upload is not canonical base64.',
      code,
    )
  }
  return new Uint8Array(decoded)
}

function decodeBase64(data: string): Uint8Array {
  return decodeCanonicalBase64(data, 'reject', 'INVALID_IMAGE_BASE64')
}

/** Store input for one decoded upload. */
function saveInput(image: EncodedImageAttachment): SaveImageAttachment {
  return {
    data: decodeBase64(image.data),
    mediaType: image.mediaType,
    ...image.name === undefined ? {} : { name: image.name },
  }
}

/**
 * Admit one wire image batch: enforce canonical base64 on every member, then
 * delegate batch admission — count and aggregate-byte limits, media-type and
 * per-image validation, ordered commit — to the store's saveImages method.
 * The shared entry for every RPC endpoint accepting browser uploads.
 * @param attachments - the deployment attachment store owning batch policy.
 * @param images - base64-encoded uploads in caller order.
 * @returns durable references in the same order as `images`.
 * @throws AttachmentError on a non-canonical payload or a refused batch.
 */
export async function admitEncodedImages(
  attachments: ImageBatchStore,
  images: readonly EncodedImageAttachment[],
): Promise<readonly ImageAttachmentRef[]> {
  return attachments.saveImages(images.map(saveInput))
}

/**
 * Admit one wire file upload: enforce canonical base64 (an empty file is a
 * valid zero-byte payload), then delegate verbatim commit to
 * the store's saveFile method. The shared entry for every RPC endpoint
 * accepting browser file uploads.
 * @param attachments - the deployment attachment store.
 * @param file - base64-encoded upload and optional display name.
 * @returns the durable content-addressed file reference.
 * @throws AttachmentError on a non-canonical payload or a storage failure.
 */
export async function admitEncodedFile(
  attachments: FileSaveStore,
  file: EncodedFileAttachment,
): Promise<FileAttachmentRef> {
  return attachments.saveFile({
    data: decodeCanonicalBase64(file.data, 'accept', 'INVALID_FILE_BASE64'),
    ...file.name === undefined ? {} : { name: file.name },
  })
}

/** Validate decoded source-batch policy before a Provider starts preparation or storage.
 * @param limits - deployment-resolved image count, aggregate byte and media-type policy.
 * @param inputs - decoded source images in owning-message order.
 */
export function validateImageBatch(limits: ImageAttachmentLimits, inputs: readonly SaveImageAttachment[]): void {
  const { maxImagesPerMessage, maxMessageImageBytes, mediaTypes } = limits
  if (inputs.length > maxImagesPerMessage) {
    throw new AttachmentError('Image batch exceeds the configured image-count limit.', 'TOO_MANY_IMAGES')
  }
  const totalBytes = inputs.reduce((sum, input) => sum + input.data.byteLength, 0)
  if (totalBytes > maxMessageImageBytes) {
    throw new AttachmentError('Image batch exceeds the configured aggregate image-byte limit.', 'IMAGES_TOO_LARGE')
  }
  for (const input of inputs) {
    if (!mediaTypes.includes(input.mediaType)) {
      throw new AttachmentError(`Image type ${input.mediaType} is not accepted by this deployment.`, 'UNSUPPORTED_IMAGE_TYPE')
    }
  }
}

/** Promote encoded prompt images while preserving ordered text and durable file references.
 * @param attachments - selected image-batch storage Provider.
 * @param content - admitted wire parts after file receipt resolution.
 * @returns ordered prompt parts with durable image references; image-free prompts perform no storage operation.
 */
export async function admitPromptContent(attachments: ImageBatchStore,
  content: readonly AttachmentAdmissionPart[]): Promise<AdmittedPromptContentPart[]> {
  if (content.every(part => part.type !== 'image')) {
    return content.map(part => part.type === 'text'
      ? { type: 'text', text: part.text }
      : { type: 'file', attachment: part.attachment })
  }
  const refs = await admitEncodedImages(attachments, content.filter(part => part.type === 'image'))
  let next = 0
  return content.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    if (part.type === 'file') return { type: 'file', attachment: part.attachment }
    return { type: 'image', attachment: refs[next++] as ImageAttachmentRef }
  })
}
