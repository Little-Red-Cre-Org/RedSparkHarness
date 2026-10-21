/** Cordis-free access to durable images and deterministic request variants. */
import { join } from 'node:path'
import { dshCachePath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {
  ImageAttachmentRef,
  ImageRequestAttachmentStore,
  ImageRequestPolicy,
  RequestImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment/types'
import { CompressionLimiter, compressionFailure } from './compression-limiter.ts'
import { readRequestImageFile, requestImageVariantId } from './request-image.ts'
import { normalizedImagePath, readImageFile } from './store.ts'

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  return reason instanceof Error
    ? reason
    : new Error('Attachment request cancelled with a non-Error reason.', { cause: reason })
}

class SharedRequest<T> {
  readonly controller = new AbortController()
  readonly promise: Promise<T>
  readonly drained: Promise<void>
  private settled = false
  private waiters = 0

  constructor(start: (signal: AbortSignal) => Promise<T>, predecessor?: Promise<void>) {
    this.promise = start(this.controller.signal).finally(() => {
      this.settled = true
    })
    this.drained = Promise.allSettled([this.promise, predecessor]).then(() => undefined)
  }

  wait(signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    this.waiters += 1
    if (signal === undefined) {
      return this.promise.finally(() => {
        this.release(false)
      })
    }
    let released = false
    const release = (cancelled: boolean): void => {
      if (released) return
      released = true
      this.release(cancelled, signal)
    }
    return new Promise<T>((resolve, reject) => {
      const abort = (): void => {
        release(true)
        reject(abortReason(signal))
      }
      signal.addEventListener('abort', abort, { once: true })
      void this.promise.then((value) => {
        signal.removeEventListener('abort', abort)
        release(false)
        resolve(value)
      }, (error: unknown) => {
        signal.removeEventListener('abort', abort)
        release(false)
        reject(compressionFailure(error))
      })
    })
  }

  private release(cancelled: boolean, signal?: AbortSignal): void {
    this.waiters -= 1
    if (cancelled && this.waiters === 0 && !this.settled && signal !== undefined) {
      this.controller.abort(abortReason(signal))
    }
  }
}

/** Instance-owned queue used to bound request-image transformations. */
export interface ImageCompressionQueue {
  /**
   * @param task - transformation occupying one queue slot until settlement.
   * @returns its result or rejection.
   */
  run<T>(task: () => Promise<T>): Promise<T>
}

/** Read the same immutable objects and request cache as the Cordis attachment service. */
export class LocalImageRequestStore implements ImageRequestAttachmentStore {
  /** Versioned absolute storage root for normalized images. */
  readonly root: string
  private readonly cacheRoot: string
  private readonly compression: ImageCompressionQueue
  private readonly readImage: (ref: ImageAttachmentRef, signal?: AbortSignal) => Promise<StoredImageAttachment>
  private readonly requestInflight = new Map<string, SharedRequest<RequestImageAttachment>>()

  /**
   * @param home - explicit Harness home; omission follows the normal DSH_HOME resolution.
   * @param compression - positive concurrency or a queue shared with image admission.
   * @param readImage - existing provider read implementation; omission reads this store's immutable objects.
   */
  constructor(
    home: string | undefined,
    compression: number | ImageCompressionQueue,
    readImage?: (ref: ImageAttachmentRef, signal?: AbortSignal) => Promise<StoredImageAttachment>,
  ) {
    if (typeof compression === 'number' && (!Number.isSafeInteger(compression) || compression < 1)) {
      throw new Error('attachment-local: image request concurrency must be a positive integer')
    }
    const dshHome = resolveDshHome(home)
    this.root = join(dshHome, 'attachments', 'v1')
    this.cacheRoot = dshCachePath({ dshHome }, 'attachments')
    this.compression = typeof compression === 'number' ? new CompressionLimiter(compression) : compression
    this.readImage = readImage ?? ((ref, signal) => readImageFile(this.root, ref, signal))
  }

  /**
   * Wait for captured transforms, including cancelled predecessors replaced under the same cache key.
   * The owner must close request admission before draining.
   * @returns completion after the transforms and their cache writes settle; request failures remain with callers.
   */
  drain(): Promise<void> {
    return Promise.all([...this.requestInflight.values()].map(operation => operation.drained)).then(() => undefined)
  }

  /**
   * @param ref - durable normalized image reference.
   * @returns provider-owned path after validating the reference.
   */
  imageHostPath(ref: ImageAttachmentRef): string {
    return normalizedImagePath(this.root, ref)
  }

  /**
   * @param ref - durable normalized image reference.
   * @param policy - route-owned request limits.
   * @param signal - optional caller cancellation.
   * @returns verified bytes and deterministic request identity.
   */
  readImageRequest(
    ref: ImageAttachmentRef,
    policy: ImageRequestPolicy,
    signal?: AbortSignal,
  ): Promise<RequestImageAttachment> {
    signal?.throwIfAborted()
    const variantId = requestImageVariantId(ref, policy)
    const key = String(variantId)
    let operation = this.requestInflight.get(key)
    if (operation === undefined || operation.controller.signal.aborted) {
      const shared = new SharedRequest<RequestImageAttachment>(sharedSignal => this.compression.run(async () => {
        const request = await readRequestImageFile(
          this.cacheRoot,
          await this.readImage(ref, sharedSignal),
          policy,
          sharedSignal,
        )
        return request
      }), operation?.drained)
      operation = shared
      this.requestInflight.set(key, shared)
      void shared.drained.then(() => {
        if (this.requestInflight.get(key) === shared) this.requestInflight.delete(key)
      })
    }
    return operation.wait(signal)
  }
}
