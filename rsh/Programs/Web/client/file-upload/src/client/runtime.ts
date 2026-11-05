/** Background browser upload implementation for Blob and byte-stream bodies. */

import { Service, type Context } from '@redspark/cordis'
import { bytesToBase64 } from '@redspark/rsh-util-crypto'
import { RemoteError } from '@redspark/rsh-typert-protocol'
import type { RemoteResult } from '@redspark/rsh-typert-protocol'
import type { SessionId } from '@redspark/rsh-session/types'
import { FILE_UPLOAD_PATH } from '../protocol.ts'
import type { EncodedFileUploadRequest, FileUploadValue } from '../types.ts'
import type { FileUploadService } from './contract.ts'
import { selectFileUploadCarrier, type FileUploadRequest } from './carrier.ts'

export { fileUploadWorker } from './carrier.ts'

interface FileUploadRemoteContext extends Context {
  readonly remote: {
    readonly fileUploads: {
      upload(
        sessionId: SessionId,
        request: EncodedFileUploadRequest,
        signal?: AbortSignal,
      ): Promise<RemoteResult<FileUploadValue>>
    }
  }
}

/** Cordis service that owns one background carrier per upload operation. */
export class FileUploadRuntime extends Service implements FileUploadService {
  readonly available: boolean
  private readonly transport: ReturnType<typeof selectFileUploadCarrier>['transport']

  /** @param ctx - providing Client context. */
  constructor(ctx: Context) {
    super(ctx, 'fileUpload')
    const selected = selectFileUploadCarrier()
    this.available = selected.available
    this.transport = selected.transport
  }

  /**
   * Post one body with the carrier selected before Cordis boot.
   * @param request - target, body, cancellation, and progress observer.
   * @returns the response status and text body.
   */
  post(request: FileUploadRequest): Promise<{ readonly status: number; readonly body: string }> {
    if (!this.available) return Promise.reject(new Error('background upload is unavailable in fixture mode'))
    return this.transport.post(request)
  }

  /**
   * Store one file for a Session.
   * @param sessionId - Session that owns the staged receipt.
   * @param data - browser Blob, exact bytes, or a one-shot byte stream.
   * @param name - optional display name.
   * @param signal - optional cancellation for the active upload.
   * @param onProgress - optional byte-progress observer for background bodies.
   * @returns the staged receipt and durable file reference, or a business error.
   */
  async upload(
    sessionId: SessionId,
    data: Blob | Uint8Array | ReadableStream<Uint8Array>,
    name?: string,
    signal?: AbortSignal,
    onProgress?: (progress: { readonly loaded: number; readonly total?: number }) => void,
  ): Promise<RemoteResult<FileUploadValue>> {
    if (!(data instanceof Uint8Array) && this.available) {
      const query = new URLSearchParams({ sessionId })
      if (name !== undefined) query.set('name', name)
      const response = await this.post({
        path: `${FILE_UPLOAD_PATH}?${query.toString()}`,
        body: data,
        headers: { 'content-type': 'application/octet-stream' },
        ...(signal === undefined ? {} : { signal }),
        ...(onProgress === undefined ? {} : { onProgress }),
      })
      if (response.status !== 200) {
        throw new Error(`file upload transport failed with HTTP ${String(response.status)}`)
      }
      return parseFileUploadResult(response.body)
    }
    if (!(data instanceof Uint8Array) && !(data instanceof Blob)) {
      throw new Error('stream file upload requires a background carrier')
    }
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer())
    return (this.ctx as FileUploadRemoteContext).remote.fileUploads.upload(
      sessionId,
      {
        data: bytesToBase64(bytes),
        ...(name === undefined ? {} : { name }),
      },
      signal,
    )
  }
}

function parseFileUploadResult(body: string): RemoteResult<FileUploadValue> {
  const value = JSON.parse(body) as unknown
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new TypeError('file upload transport returned an invalid result')
  }
  if (!value.ok) {
    const error = value.error
    if (!isRecord(error) || typeof error.code !== 'string'
      || typeof error.message !== 'string' || !isRecord(error.details)) {
      throw new TypeError('file upload transport returned an invalid failure')
    }
    return {
      ok: false,
      error: new RemoteError(error.code as never, error.message, error.details as never),
    }
  }
  const result = value.value
  const file = isRecord(result) ? result.file : undefined
  if (!isRecord(result) || typeof result.receiptId !== 'string' || !isRecord(file)
    || typeof file.attachmentId !== 'string' || typeof file.name !== 'string'
    || typeof file.bytes !== 'number' || !Number.isSafeInteger(file.bytes) || file.bytes < 0) {
    throw new TypeError('file upload transport returned an invalid receipt')
  }
  return {
    ok: true,
    value: {
      receiptId: result.receiptId as FileUploadValue['receiptId'],
      file: {
        attachmentId: file.attachmentId as FileUploadValue['file']['attachmentId'],
        name: file.name,
        bytes: file.bytes,
      },
    },
  }
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
