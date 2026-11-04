/**
 * Native entry for staged Session file uploads.
 *
 * The compatibility plugin posts Blob and stream bodies to the Cordis route and
 * sends exact bytes through `remote.fileUploads`. A Native host has neither that
 * route nor that remote, so this plugin posts every body, including exact bytes,
 * to `POST /api/native-session/file-upload` and returns the Native receipt the
 * Session client already accepts on queue and steer.
 */

import { brandString } from '@redspark/rsh-brand'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { SessionId } from '@redspark/rsh-session/types'
import type { NativeSessionFileReceipt, NativeSessionFileReceiptId } from '@redspark/rsh-client-native-session/follow-types'
import { selectFileUploadCarrier, type FileUploadTransport } from './client/carrier.ts'

/** Native Session raw-byte route. The compatibility route stays in `protocol.ts`. */
const NATIVE_FILE_UPLOAD_PATH = '/api/native-session/file-upload'

/**
 * Failure of one Native upload.
 *
 * Transport and business failures both reject. The compatibility service returns
 * a `RemoteResult` for business failures; this service has no Remote carrier, so
 * a business refusal is an error whose `code` is the Host code.
 */
export class NativeFileUploadError extends Error {
  /**
   * @param code - Host failure code, `transport` for an HTTP failure, or `invalid` for a malformed body.
   * @param message - Host or transport message safe to show to the caller.
   */
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'NativeFileUploadError'
  }
}

/** Browser upload service addressed by one Session identity. */
export interface ClientFileUpload {
  /** Whether this page has a Host-backed background upload carrier. */
  readonly available: boolean
  /**
   * Store one file for a Session.
   * @param sessionId - Session that owns the staged receipt.
   * @param data - browser Blob, exact bytes, or a one-shot byte stream.
   * @param name - optional display name.
   * @param signal - optional cancellation for the active upload.
   * @param onProgress - optional byte-progress observer.
   * @returns the Native receipt consumed by a later prompt, queue, or steer.
   */
  upload(
    sessionId: SessionId,
    data: Blob | Uint8Array | ReadableStream<Uint8Array>,
    name?: string,
    signal?: AbortSignal,
    onProgress?: (progress: { readonly loaded: number; readonly total?: number }) => void,
  ): Promise<NativeSessionFileReceipt>
}

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices {
    /** Progress-capable Session file upload over the Native raw-byte route. */
    clientFileUpload: ClientFileUpload
  }
}

/**
 * Parse the Native file-upload HTTP body.
 * @param body - response text from `POST /api/native-session/file-upload`.
 * @returns the receipt the Native Session client accepts.
 * @throws {NativeFileUploadError} when the body is not a receipt envelope.
 */
export function parseNativeFileUploadBody(body: string): NativeSessionFileReceipt {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'file upload transport returned invalid JSON'
    throw new NativeFileUploadError('invalid', message)
  }
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new NativeFileUploadError('invalid', 'file upload transport returned an invalid result')
  }
  if (!value.ok) {
    const error = value.error
    if (!isRecord(error) || typeof error.code !== 'string' || typeof error.message !== 'string') {
      throw new NativeFileUploadError('invalid', 'file upload transport returned an invalid failure')
    }
    throw new NativeFileUploadError(error.code, error.message)
  }
  const receipt = value.value
  if (!isRecord(receipt) || typeof receipt.receiptId !== 'string' || receipt.receiptId.length === 0
    || typeof receipt.name !== 'string' || typeof receipt.bytes !== 'number'
    || !Number.isSafeInteger(receipt.bytes) || receipt.bytes < 0) {
    throw new NativeFileUploadError('invalid', 'file upload transport returned an invalid receipt')
  }
  return {
    receiptId: brandString<NativeSessionFileReceiptId>(receipt.receiptId),
    name: receipt.name,
    bytes: receipt.bytes,
  }
}

/**
 * Copy exact bytes into a Blob the carrier can post.
 * @param data - caller-owned bytes; the copy does not alias their buffer.
 * @returns a Blob of those bytes.
 */
function blobFromBytes(data: Uint8Array): Blob {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return new Blob([copy])
}

/** Carrier substitute a test supplies instead of reading the page hook. */
export interface NativeFileUploadCarrierOverride {
  readonly transport: FileUploadTransport
  readonly available: boolean
}

/**
 * Build the upload service from the page carrier selected at call time.
 * @param override - carrier substitute; omitted in production, where the page hook is read once.
 * @returns the service installed as `clientFileUpload`.
 */
export function createNativeFileUpload(override?: NativeFileUploadCarrierOverride): ClientFileUpload {
  const selected = override ?? selectFileUploadCarrier()
  return {
    available: selected.available,
    async upload(sessionId, data, name, signal, onProgress) {
      if (!selected.available) {
        throw new NativeFileUploadError('unavailable', 'background upload is unavailable in fixture mode')
      }
      const query = new URLSearchParams({ sessionId })
      if (name !== undefined) query.set('name', name)
      const response = await selected.transport.post({
        path: `${NATIVE_FILE_UPLOAD_PATH}?${query.toString()}`,
        body: data instanceof Uint8Array ? blobFromBytes(data) : data,
        headers: { 'content-type': 'application/octet-stream' },
        ...(signal === undefined ? {} : { signal }),
        ...(onProgress === undefined ? {} : { onProgress }),
      })
      if (response.status !== 200) {
        throw new NativeFileUploadError('transport', `file upload transport failed with HTTP ${String(response.status)}`)
      }
      return parseNativeFileUploadBody(response.body)
    },
  }
}

/** Native staged-file upload. It provides `clientFileUpload` and accepts no configuration. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-client-file-upload',
  targets: ['client'],
  requires: [],
  optional: [],
  provides: ['clientFileUpload'],
  resolve(input) {
    if (input !== undefined) throw new Error('native file upload: the entry accepts no configuration')
    return (context) => {
      context.provide('clientFileUpload', createNativeFileUpload())
    }
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
