/** Cordis-free durable local attachment operations. */
import { join } from 'node:path'
import { admitEncodedFile, admitPromptContent, validateImageBatch } from '@deepseek-ai/dsh-attachment/admission'
import { isAttachmentError, type AttachmentError } from '@deepseek-ai/dsh-attachment/error'
import type {
  AdmittedPromptContentPart, AttachmentAdmissionPart, AttachmentOperations, EncodedFileAttachment,
  FileAttachmentRef, ImageAttachmentLimits, ImageAttachmentRef, ImageRequestPolicy,
  RequestImageAttachment, SaveFileAttachment, SaveFileStreamAttachment, SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment/types'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { CompressionLimiter } from './compression-limiter.ts'
import { type Config, resolveConfig } from './config.ts'
import { readFileStreamVerbatim, saveFileStreamVerbatim, saveFileVerbatim, storedFilePath } from './file-store.ts'
import type { NormalizationPolicy } from './normalization.ts'
import { LocalImageRequestStore } from './request-store.ts'
import { commitPreparedImageFile, prepareImageFile, readImageFile, validateImageFile, type PreparedImageFile } from './store.ts'

/** Content-addressed storage used by native and Cordis attachment providers. */
export class LocalAttachmentBackend implements AttachmentOperations {
  /** Versioned absolute storage root. */
  readonly root: string
  /** Resolved upload-admission policy. */
  readonly imageLimits: ImageAttachmentLimits
  /** Resolved provider-independent normalization policy. */
  readonly normalizationPolicy: Readonly<NormalizationPolicy>
  /** Maximum simultaneous image transforms. */
  readonly imageCompressionConcurrency: number
  private readonly compression: CompressionLimiter
  private readonly requests: LocalImageRequestStore

  /**
   * @param config - explicit local storage and image policies.
   * @param readImage - optional provider override used for request projection.
   */
  constructor(
    config: Config,
    readImage?: (ref: ImageAttachmentRef, signal?: AbortSignal) => Promise<StoredImageAttachment>,
  ) {
    const dshHome = resolveDshHome(config.dshHome)
    this.root = join(dshHome, 'attachments', 'v1')
    const resolved = resolveConfig(config)
    this.imageLimits = resolved.imageLimits
    this.normalizationPolicy = resolved.normalizationPolicy
    this.imageCompressionConcurrency = resolved.imageCompressionConcurrency
    this.compression = new CompressionLimiter(resolved.imageCompressionConcurrency)
    this.requests = new LocalImageRequestStore(dshHome, this.compression, readImage ?? ((ref, signal) => this.readImage(ref, signal)))
  }

  /**
   * Wait for request transforms after the owning facade has stopped admitting calls.
   * @returns completion after accepted request work and cache publication settle.
   */
  drainRequests(): Promise<void> { return this.requests.drain() }

  /** Validate one image without writing an object. */
  async validateImage(input: SaveImageAttachment): Promise<void> {
    await this.compression.run(() => validateImageFile(input, this.imageLimits, this.normalizationPolicy))
  }

  /** Settle every accepted preparation before reporting failures; publish only a fully prepared ordered batch. */
  async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]> {
    validateImageBatch(this.imageLimits, inputs)
    const results = await Promise.allSettled(inputs.map(input => this.compression.run(
      () => prepareImageFile(input, this.imageLimits, this.normalizationPolicy),
    )))
    const prepared: PreparedImageFile[] = []
    const failures: unknown[] = []
    for (const result of results) {
      if (result.status === 'fulfilled') prepared.push(result.value)
      else failures.push(result.reason)
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'attachment-local: image batch preparation failed')
    const refs: ImageAttachmentRef[] = []
    for (const image of prepared) refs.push(await commitPreparedImageFile(this.root, image))
    return refs
  }

  /** Validate and durably publish one normalized image. */
  async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    const prepared = await this.compression.run(() => prepareImageFile(input, this.imageLimits, this.normalizationPolicy))
    return commitPreparedImageFile(this.root, prepared)
  }

  /** Read and verify one durable normalized image. */
  readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment> {
    return readImageFile(this.root, ref, signal)
  }

  /** Resolve a validated image reference to this provider's host path. */
  imageHostPath(ref: ImageAttachmentRef): string {
    return this.requests.imageHostPath(ref)
  }

  /** Persist exact file bytes. */
  saveFile(input: SaveFileAttachment): Promise<FileAttachmentRef> {
    return saveFileVerbatim(this.root, input)
  }

  /** Persist a file from bounded chunks. */
  saveFileStream(input: SaveFileStreamAttachment): Promise<FileAttachmentRef> {
    return saveFileStreamVerbatim(this.root, input)
  }

  /** Read and verify exact file bytes as bounded chunks. */
  readFileStream(ref: FileAttachmentRef, signal?: AbortSignal): AsyncIterable<Uint8Array> {
    return readFileStreamVerbatim(this.root, ref, signal)
  }

  /** Resolve a validated file reference to this provider's host path. */
  fileHostPath(ref: FileAttachmentRef): string {
    return storedFilePath(this.root, ref)
  }

  /** Read the deterministic model-request variant of a durable image. */
  readImageRequest(ref: ImageAttachmentRef, policy: ImageRequestPolicy, signal?: AbortSignal): Promise<RequestImageAttachment> {
    return this.requests.readImageRequest(ref, policy, signal)
  }

  /** Decode and admit a canonical base64 file upload. */
  admitEncodedFile(input: EncodedFileAttachment): Promise<FileAttachmentRef> {
    return admitEncodedFile(this, input)
  }

  /** Identify a stable attachment failure. */
  isAttachmentError(error: unknown): error is AttachmentError {
    return isAttachmentError(error)
  }

  /** Promote wire images to durable references before session logging. */
  async admitPromptContent(content: readonly AttachmentAdmissionPart[]): Promise<AdmittedPromptContentPart[]> {
    return admitPromptContent(this, content)
  }

}
