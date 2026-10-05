/** Native local attachment Provider with installation-owned operation draining. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-attachment/native'
import type {
  AdmittedPromptContentPart, AttachmentAdmissionPart, AttachmentOperations,
  EncodedFileAttachment, FileAttachmentRef, ImageAttachmentRef, ImageRequestPolicy,
  RequestImageAttachment, SaveFileAttachment, SaveFileStreamAttachment, SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment/native'
import { LocalAttachmentBackend } from './backend.ts'
import { parseConfig } from './config.ts'

/** Native service facade that refuses new work after uninstall and drains accepted work. */
export class NativeLocalAttachmentStore implements AttachmentOperations {
  private readonly abort = new AbortController()
  private readonly active = new Set<Promise<unknown>>()
  private readonly streams = new Set<AsyncIterator<Uint8Array>>()
  private closed = false
  private closing: Promise<void> | undefined

  /** @param backend - durable storage shared with the legacy provider. */
  constructor(private readonly backend: LocalAttachmentBackend) {}

  get imageLimits(): AttachmentOperations['imageLimits'] { return this.backend.imageLimits }

  private signal(caller?: AbortSignal): AbortSignal {
    return caller === undefined ? this.abort.signal : AbortSignal.any([this.abort.signal, caller])
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('attachment-local: provider is closing'))
    const work = Promise.resolve().then(task)
    this.active.add(work)
    void work.finally(() => { this.active.delete(work) }).catch(() => {})
    return work
  }

  /**
   * Reject new operations, cancel reads, drain accepted work, and report stream cleanup failures.
   * @returns the shared shutdown promise, rejecting with stream cleanup failures after every accepted operation settles.
   */
  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.closed = true
    this.abort.abort(new Error('attachment-local: provider is closing'))
    const work = [...this.active]
    const streamEnds = [...this.streams].map(stream => Promise.resolve().then(() => stream.return?.()))
    this.streams.clear()
    this.closing = Promise.allSettled([...work, ...streamEnds]).then(async (results) => {
      await this.backend.drainRequests()
      const failures = results.slice(work.length).flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) throw new AggregateError(failures, 'attachment-local: file stream cleanup failed')
    })
    return this.closing
  }

  validateImage(input: SaveImageAttachment): Promise<void> {
    return this.run(() => this.backend.validateImage(input))
  }

  saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]> {
    return this.run(() => this.backend.saveImages(inputs))
  }

  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    return this.run(() => this.backend.saveImage(input))
  }

  readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment> {
    return this.run(() => this.backend.readImage(ref, this.signal(signal)))
  }

  imageHostPath(ref: ImageAttachmentRef): string {
    if (this.closed) throw new Error('attachment-local: provider is closing')
    return this.backend.imageHostPath(ref)
  }

  saveFile(input: SaveFileAttachment): Promise<FileAttachmentRef> {
    return this.run(() => this.backend.saveFile(input))
  }

  saveFileStream(input: SaveFileStreamAttachment): Promise<FileAttachmentRef> {
    return this.run(() => this.backend.saveFileStream({ ...input, signal: this.signal(input.signal) }))
  }

  readFileStream(ref: FileAttachmentRef, signal?: AbortSignal): AsyncIterable<Uint8Array> {
    if (this.closed) throw new Error('attachment-local: provider is closing')
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<Uint8Array> => {
        if (this.closed) throw new Error('attachment-local: provider is closing')
        const stream = this.backend.readFileStream(ref, this.signal(signal))[Symbol.asyncIterator]()
        this.streams.add(stream)
        return {
          next: (): Promise<IteratorResult<Uint8Array>> => this.run(async () => {
            try {
              const result = await stream.next()
              if (result.done) this.streams.delete(stream)
              return result
            } catch (error) {
              this.streams.delete(stream)
              throw error
            }
          }),
          return: async (): Promise<IteratorResult<Uint8Array>> => {
            try {
              return await stream.return?.() ?? { done: true, value: undefined }
            } finally { this.streams.delete(stream) }
          },
        }
      },
    }
  }

  fileHostPath(ref: FileAttachmentRef): string {
    if (this.closed) throw new Error('attachment-local: provider is closing')
    return this.backend.fileHostPath(ref)
  }

  readImageRequest(ref: ImageAttachmentRef, policy: ImageRequestPolicy, signal?: AbortSignal): Promise<RequestImageAttachment> {
    return this.run(() => this.backend.readImageRequest(ref, policy, this.signal(signal)))
  }

  admitEncodedFile(input: EncodedFileAttachment): Promise<FileAttachmentRef> {
    return this.run(() => this.backend.admitEncodedFile(input))
  }

  admitPromptContent(content: readonly AttachmentAdmissionPart[]): Promise<AdmittedPromptContentPart[]> {
    return this.run(() => this.backend.admitPromptContent(content))
  }

  isAttachmentError(error: unknown): boolean {
    return this.backend.isAttachmentError(error)
  }
}

/** Install one durable attachment owner in the native Host scope. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-attachment-local', targets: ['host'],
  requires: [], provides: ['attachments'],
  resolve(input) {
    const config = parseConfig(input)
    return (context) => {
      const service = new NativeLocalAttachmentStore(new LocalAttachmentBackend(config))
      const cancel = (): void => {
        void service.close().catch(() => { /* The owned disposer awaits the same close promise and reports cleanup failure. */ })
      }
      context.signal.addEventListener('abort', cancel, { once: true })
      context.own(async () => {
        context.signal.removeEventListener('abort', cancel)
        await service.close()
      })
      if (context.signal.aborted) cancel()
      context.provide('attachments', service)
    }
  },
}
