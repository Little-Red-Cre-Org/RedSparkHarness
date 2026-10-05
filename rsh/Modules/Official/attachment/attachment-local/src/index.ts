/** Local durable attachment backend rooted below `DSH_HOME`. @module @deepseek-ai/dsh-attachment-local */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {
  FileAttachmentRef,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
  SaveFileAttachment,
  SaveFileStreamAttachment,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { LocalAttachmentBackend } from './backend.ts'
import {
  DEFAULT_IMAGE_COMPRESSION_CONCURRENCY, DEFAULT_MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_DIMENSION,
  DEFAULT_MAX_IMAGE_PIXELS, DEFAULT_MAX_IMAGES_PER_MESSAGE, DEFAULT_MAX_MESSAGE_IMAGE_BYTES,
  DEFAULT_NORMALIZED_IMAGE_MAX_BYTES, DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION,
  DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS, MAX_IMAGE_COMPRESSION_CONCURRENCY,
} from './config.ts'
import type { Config } from './config.ts'

export { canPassThroughNormalization, normalizeImage } from './normalization.ts'
export type { NormalizedImage, NormalizationPolicy } from './normalization.ts'
export { commitPreparedImageFile, prepareImageFile, readImageFile, saveImageFile, validateImageFile } from './store.ts'
export type { PreparedImageFile } from './store.ts'
export { readRequestImageFile, requestImageVariantId } from './request-image.ts'

export type { Config } from './config.ts'
export {
  DEFAULT_IMAGE_COMPRESSION_CONCURRENCY, DEFAULT_MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_DIMENSION,
  DEFAULT_MAX_IMAGE_PIXELS, DEFAULT_MAX_IMAGES_PER_MESSAGE, DEFAULT_MAX_MESSAGE_IMAGE_BYTES,
  DEFAULT_NORMALIZED_IMAGE_MAX_BYTES, DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION,
  DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS, MAX_IMAGE_COMPRESSION_CONCURRENCY,
} from './config.ts'

/** Persistent content-addressed local attachment store. */
export class LocalAttachmentStore extends AttachmentStore {
  static Config: z<Config> = z.object({
    dshHome: z.string(),
    maxImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_BYTES),
    maxImagesPerMessage: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGES_PER_MESSAGE),
    maxMessageImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_IMAGE_BYTES),
    maxImagePixels: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_PIXELS),
    maxImageDimension: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_DIMENSION),
    normalizedImageMaxPixels: z.number().step(1).min(1).default(DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS),
    normalizedImageMaxDimension: z.number().step(1).min(1).default(DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION),
    normalizedImageMaxBytes: z.number().step(1).min(1).default(DEFAULT_NORMALIZED_IMAGE_MAX_BYTES),
    imageCompressionConcurrency: z.number().step(1).min(1).max(MAX_IMAGE_COMPRESSION_CONCURRENCY)
      .default(DEFAULT_IMAGE_COMPRESSION_CONCURRENCY),
  })

  /** Absolute versioned storage root. */
  readonly root: string
  readonly imageLimits: LocalAttachmentBackend['imageLimits']
  /** Resolved provider-independent normalization policy. */
  readonly normalizationPolicy: LocalAttachmentBackend['normalizationPolicy']
  /** Resolved instance-level compression limit. */
  readonly imageCompressionConcurrency: number
  private readonly backend: LocalAttachmentBackend

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.backend = new LocalAttachmentBackend(config, (ref, signal) => this.readImage(ref, signal))
    this.root = this.backend.root
    this.imageLimits = this.backend.imageLimits
    this.normalizationPolicy = this.backend.normalizationPolicy
    this.imageCompressionConcurrency = this.backend.imageCompressionConcurrency
  }

  async validateImage(input: SaveImageAttachment): Promise<void> {
    await this.backend.validateImage(input)
  }

  override async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]> {
    return this.backend.saveImages(inputs)
  }

  async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    return this.backend.saveImage(input)
  }

  async readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment> {
    return this.backend.readImage(ref, signal)
  }

  override imageHostPath(ref: ImageAttachmentRef): string {
    return this.backend.imageHostPath(ref)
  }

  override async saveFile(input: SaveFileAttachment): Promise<FileAttachmentRef> {
    return this.backend.saveFile(input)
  }

  override async saveFileStream(input: SaveFileStreamAttachment): Promise<FileAttachmentRef> {
    return this.backend.saveFileStream(input)
  }

  override readFileStream(ref: FileAttachmentRef, signal?: AbortSignal): AsyncIterable<Uint8Array> {
    return this.backend.readFileStream(ref, signal)
  }

  override fileHostPath(ref: FileAttachmentRef): string {
    return this.backend.fileHostPath(ref)
  }

  override async readImageRequest(
    ref: ImageAttachmentRef,
    policy: ImageRequestPolicy,
    signal?: AbortSignal,
  ): Promise<RequestImageAttachment> {
    return this.backend.readImageRequest(ref, policy, signal)
  }

}

export default LocalAttachmentStore
