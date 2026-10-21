/** Leading-signature allow-list applied before encoded bytes reach Sharp. */

import sharp, { type Sharp } from 'sharp'
import { AttachmentError } from '@deepseek-ai/dsh-attachment/error'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment/types'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const
const GIF87A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] as const
const GIF89A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] as const
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46] as const
const WEBP_FORM_TYPE = [0x57, 0x45, 0x42, 0x50] as const
/** Byte offset of the RIFF form type that follows the 4-byte chunk size. */
const WEBP_FORM_TYPE_OFFSET = 8

function startsWith(data: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (data.byteLength < offset + signature.length) return false
  return signature.every((byte, index) => data[offset + index] === byte)
}

/**
 * Identify a supported raster container from its leading signature bytes.
 * Only PNG, JPEG, WebP (RIFF/WEBP), and GIF87a/GIF89a are recognized; every
 * other container, including HEIF/AVIF `ftyp` boxes, SVG/XML text, and TIFF,
 * returns undefined.
 * @param data - complete encoded image bytes.
 * @returns the media type named by the signature, or undefined when no supported signature matches.
 */
export function sniffImageMediaType(data: Uint8Array): ImageMediaType | undefined {
  if (startsWith(data, PNG_SIGNATURE)) return 'image/png'
  if (startsWith(data, JPEG_SIGNATURE)) return 'image/jpeg'
  if (startsWith(data, GIF87A_SIGNATURE) || startsWith(data, GIF89A_SIGNATURE)) return 'image/gif'
  if (startsWith(data, RIFF_SIGNATURE) && startsWith(data, WEBP_FORM_TYPE, WEBP_FORM_TYPE_OFFSET)) return 'image/webp'
  return undefined
}

/**
 * Open encoded bytes in Sharp only after their signature matches a supported
 * raster container. libvips selects its loader from the input bytes, so bytes
 * outside the allow-list never reach a decoder that this package does not
 * accept.
 * @param data - complete encoded image bytes.
 * @returns a Sharp pipeline that fails on decode errors and leaves pixel limits to the caller.
 * @throws AttachmentError with code `INVALID_IMAGE` when the signature is not PNG, JPEG, WebP, or GIF.
 */
export function openSupportedImage(data: Uint8Array): Sharp {
  if (sniffImageMediaType(data) === undefined) {
    throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE')
  }
  return sharp(data, { failOn: 'error', limitInputPixels: false })
}
