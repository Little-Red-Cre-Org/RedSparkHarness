/** Shared Cordis-free image format and model-facing text for file reads. */
import { extname } from 'node:path'
import type { ImageAttachmentLimits, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment/native'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment/types'

const IMAGE_EXTENSIONS: Readonly<Record<string, ImageMediaType>> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif',
}

function matchesBytes(data: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return data.byteLength >= offset + expected.length
    && expected.every((byte, index) => data[offset + index] === byte)
}

function matchesAscii(data: Uint8Array, offset: number, value: string): boolean {
  if (data.byteLength < offset + value.length) return false
  for (let index = 0; index < value.length; index += 1) {
    if (data[offset + index] !== value.charCodeAt(index)) return false
  }
  return true
}

/**
 * Identify PNG, JPEG, WebP, or GIF from its file signature.
 * @param data - file bytes.
 * @returns a supported signature type, if present.
 */
export function sniffImageMediaType(data: Uint8Array): ImageMediaType | undefined {
  if (matchesBytes(data, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (matchesBytes(data, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (matchesAscii(data, 0, 'GIF87a') || matchesAscii(data, 0, 'GIF89a')) return 'image/gif'
  if (matchesAscii(data, 0, 'RIFF') && matchesAscii(data, 8, 'WEBP')) return 'image/webp'
  return undefined
}

/**
 * Read the image type declared by a filename extension.
 * @param filePath - model-supplied path.
 * @returns its declared supported type, if any.
 */
export function imageMediaTypeForPath(filePath: string): ImageMediaType | undefined {
  return IMAGE_EXTENSIONS[extname(filePath).toLowerCase()]
}

/**
 * Format an image read beside its durable image block.
 * @param displayPath - filesystem-resolved display path.
 * @param image - normalized image metadata.
 * @returns the model-facing text including original dimensions when downscaled.
 */
export function formatImageReadOutput(
  displayPath: string,
  image: Pick<ImageAttachmentRef, 'mediaType' | 'bytes' | 'width' | 'height' | 'originalDimensions'>,
): string {
  let scaled = ''
  if (image.originalDimensions !== undefined) {
    const x = (image.originalDimensions.width / image.width).toFixed(2)
    const y = (image.originalDimensions.height / image.height).toFixed(2)
    const advice = x === y
      ? `multiply coordinates by ${x}`
      : `multiply x coordinates by ${x} and y coordinates by ${y}`
    scaled = ` (downscaled from ${image.originalDimensions.width}x${image.originalDimensions.height} px; ${advice} to locate features in the original file)`
  }
  return `<path>${displayPath}</path>\n<type>image</type>\n<content>\n${image.mediaType} image, ${image.width}x${image.height} px, ${image.bytes} bytes${scaled}\n</content>`
}

/**
 * Preserve the file-specific recovery text for attachment admission failures.
 * @param error - failure raised while storing image bytes.
 * @param displayPath - filesystem-resolved path.
 * @param declared - whether a filename extension declared the format.
 * @param mediaType - format selected from the extension or signature.
 * @param extension - lowercase filename extension, when present.
 * @param limits - deployment image limits used in recovery instructions.
 * @param isAttachmentError - selected Provider's runtime error recognition.
 * @returns the original or a recoverable file-read error.
 */
export function imageStorageError(
  error: unknown, displayPath: string, declared: boolean, mediaType: ImageMediaType,
  extension: string, limits: ImageAttachmentLimits, isAttachmentError: (error: unknown) => boolean,
): unknown {
  if (!isAttachmentError(error)) return error
  const failure = error as Error & { code: string }
  if (failure.code === 'IMAGE_DIMENSION_TOO_LARGE') {
    return new Error(`cannot read "${displayPath}": at least one image side exceeds the ${limits.maxImageDimension}px limit; downscale the image and read the smaller copy`, { cause: error })
  }
  if (failure.code === 'IMAGE_TOO_MANY_PIXELS') {
    return new Error(`cannot read "${displayPath}": the image exceeds the ${limits.maxImagePixels}-pixel decoded-size limit; downscale the image and read the smaller copy`, { cause: error })
  }
  if (failure.code === 'IMAGE_TOO_LARGE') {
    return new Error(`cannot read "${displayPath}": the image cannot be stored within the deployment's byte limits; downscale the image and read the smaller copy`, { cause: error })
  }
  if (failure.code === 'ATTACHMENT_WRITE_FAILED' && /16-bit PNG/iu.test(failure.message)) {
    return new Error(`cannot read "${displayPath}": the 16-bit PNG could not be converted to the normalized 8-bit sRGB form; convert it to an 8-bit PNG/JPEG/WebP and retry`, { cause: error })
  }
  if (failure.code === 'INVALID_IMAGE' && !declared) {
    return new Error(`cannot read "${displayPath}": the bytes do not decode as a supported PNG/JPEG/WebP/GIF image; the file may be truncated or corrupt`, { cause: error })
  }
  if (failure.code !== 'IMAGE_TYPE_MISMATCH') return error
  if (!declared) {
    return new Error(`cannot read "${displayPath}": the file signature claims ${mediaType}, but the bytes decode as a different image format; the file may be corrupt`, { cause: error })
  }
  return new Error(`cannot read "${displayPath}": the ${extension} extension declares ${mediaType}, but the bytes use a different image format; rename the file to match its actual format if it is PNG/JPEG/WebP/GIF, or convert it to one of those formats`, { cause: error })
}
