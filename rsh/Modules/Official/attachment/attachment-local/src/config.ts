/** Cordis-free local attachment storage configuration and resolved limits. */
import type { ImageAttachmentLimits } from '@deepseek-ai/dsh-attachment/types'
import type { NormalizationPolicy } from './normalization.ts'

/** Default maximum encoded bytes for one submitted image. */
export const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** Default maximum images in one prompt. */
export const DEFAULT_MAX_IMAGES_PER_MESSAGE = 20
/** Default maximum aggregate image bytes in one prompt. */
export const DEFAULT_MAX_MESSAGE_IMAGE_BYTES = 200 * 1024 * 1024
/** Default maximum intrinsic pixels for one submitted image. */
export const DEFAULT_MAX_IMAGE_PIXELS = 64_000_000
/** Default per-side pixel cap for one submitted image. */
export const DEFAULT_MAX_IMAGE_DIMENSION = 8192
/** Default total-pixel budget of the stored normalized image. */
export const DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS = 2048 * 2048
/** Default long-edge cap of the stored normalized image. */
export const DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION = 8192
/** Default encoded-byte target for one stored normalized image. */
export const DEFAULT_NORMALIZED_IMAGE_MAX_BYTES = 4 * 1024 * 1024
/** Default number of simultaneous image transformations per store. */
export const DEFAULT_IMAGE_COMPRESSION_CONCURRENCY = 2
/** Maximum configurable image transformations per store. */
export const MAX_IMAGE_COMPRESSION_CONCURRENCY = 8

/** Local attachment backend configuration. */
export interface Config {
  /** Explicit harness home; omitted follows `DSH_HOME`, then `~/.dsh`. */
  dshHome?: string
  /** Maximum encoded bytes accepted for one submitted image. */
  maxImageBytes?: number
  /** Maximum image count accepted in one submitted message. */
  maxImagesPerMessage?: number
  /** Maximum aggregate encoded image bytes accepted in one submitted message. */
  maxMessageImageBytes?: number
  /** Maximum intrinsic width multiplied by height accepted for one submitted image. */
  maxImagePixels?: number
  /** Maximum intrinsic width and height accepted for one submitted image. */
  maxImageDimension?: number
  /** Total-pixel budget of the stored normalized image. */
  normalizedImageMaxPixels?: number
  /** Long-edge pixel cap of the stored normalized image. */
  normalizedImageMaxDimension?: number
  /** Encoded-byte target of the stored normalized image. */
  normalizedImageMaxBytes?: number
  /** Maximum simultaneous normalization or request-image transformations. */
  imageCompressionConcurrency?: number
}

const CONFIG_FIELDS = new Set([
  'dshHome', 'maxImageBytes', 'maxImagesPerMessage', 'maxMessageImageBytes',
  'maxImagePixels', 'maxImageDimension', 'normalizedImageMaxPixels',
  'normalizedImageMaxDimension', 'normalizedImageMaxBytes', 'imageCompressionConcurrency',
])

/**
 * Parse a native installation's storage configuration before activation.
 * @param input - untrusted installation config.
 * @returns validated local options.
 */
export function parseConfig(input: unknown): Config {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('attachment-local: configuration must be an object')
  }
  const fields = input as Record<string, unknown>
  for (const [name, value] of Object.entries(fields)) {
    if (!CONFIG_FIELDS.has(name)) throw new Error(`attachment-local: unknown configuration field ${name}`)
    if (name === 'dshHome') {
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error('attachment-local: dshHome must be a nonempty path')
      }
    } else if (typeof value !== 'number') {
      throw new Error(`attachment-local: ${name} must be a positive integer`)
    }
  }
  const config = fields as Config
  resolveConfig(config)
  return config
}

/**
 * Resolve and validate limits shared by native and Cordis providers.
 * @param config - parsed local options.
 * @returns immutable image limits and transform concurrency.
 */
export function resolveConfig(config: Config): {
  imageLimits: ImageAttachmentLimits
  normalizationPolicy: Readonly<NormalizationPolicy>
  imageCompressionConcurrency: number
} {
  const imageLimits: ImageAttachmentLimits = Object.freeze({
    maxImageBytes: config.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
    maxImagesPerMessage: config.maxImagesPerMessage ?? DEFAULT_MAX_IMAGES_PER_MESSAGE,
    maxMessageImageBytes: config.maxMessageImageBytes ?? DEFAULT_MAX_MESSAGE_IMAGE_BYTES,
    maxImagePixels: config.maxImagePixels ?? DEFAULT_MAX_IMAGE_PIXELS,
    maxImageDimension: config.maxImageDimension ?? DEFAULT_MAX_IMAGE_DIMENSION,
    mediaTypes: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const),
  })
  const normalizationPolicy = Object.freeze({
    maxPixels: config.normalizedImageMaxPixels ?? DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS,
    maxDimension: config.normalizedImageMaxDimension ?? DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION,
    maxBytes: config.normalizedImageMaxBytes ?? DEFAULT_NORMALIZED_IMAGE_MAX_BYTES,
  })
  const imageCompressionConcurrency = config.imageCompressionConcurrency ?? DEFAULT_IMAGE_COMPRESSION_CONCURRENCY
  for (const [name, value] of Object.entries({
    maxImageBytes: imageLimits.maxImageBytes,
    maxImagesPerMessage: imageLimits.maxImagesPerMessage,
    maxMessageImageBytes: imageLimits.maxMessageImageBytes,
    maxImagePixels: imageLimits.maxImagePixels,
    maxImageDimension: imageLimits.maxImageDimension,
    normalizedImageMaxPixels: normalizationPolicy.maxPixels,
    normalizedImageMaxDimension: normalizationPolicy.maxDimension,
    normalizedImageMaxBytes: normalizationPolicy.maxBytes,
  })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`attachment-local: ${name} must be a positive integer`)
    }
  }
  if (!Number.isSafeInteger(imageCompressionConcurrency)
    || imageCompressionConcurrency < 1
    || imageCompressionConcurrency > MAX_IMAGE_COMPRESSION_CONCURRENCY) {
    throw new Error(
      `attachment-local: imageCompressionConcurrency must be an integer from 1 through ${MAX_IMAGE_COMPRESSION_CONCURRENCY}`,
    )
  }
  return { imageLimits, normalizationPolicy, imageCompressionConcurrency }
}
