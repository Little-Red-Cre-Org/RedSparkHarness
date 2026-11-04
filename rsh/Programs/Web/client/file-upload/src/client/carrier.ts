/**
 * Cordis-free background upload carrier.
 *
 * The compatibility plugin and the Native entry both post raw bytes through this
 * carrier. The compatibility plugin still falls back to Cordis Remote for exact
 * bytes; the Native entry never does. Importing this module must not pull Cordis.
 */

import type { ClientFileUploadHooks, FileUploadFetch } from '../types.ts'

/** Body the background carrier can post without reading it on the page thread. */
type FileUploadCarrierBody = Blob | ReadableStream<Uint8Array>

/** One raw POST the carrier sends without interpreting the route. */
export interface FileUploadRequest {
  readonly path: string
  readonly body: FileUploadCarrierBody
  readonly headers?: Readonly<Record<string, string>>
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: { readonly loaded: number; readonly total?: number }) => void
}

/** Status and text body returned by the selected carrier. */
export interface FileUploadResponse {
  readonly status: number
  readonly body: string
}

interface UploadWorkerStart {
  readonly url: string
  readonly body: FileUploadCarrierBody
  readonly headers: Readonly<Record<string, string>>
}

type UploadWorkerOutput =
  | { readonly kind: 'progress'; readonly loaded: number; readonly total?: number }
  | { readonly kind: 'complete'; readonly status: number; readonly body: string }
  | { readonly kind: 'error'; readonly message: string }

interface UploadWorkerScope {
  onmessage: ((event: MessageEvent<UploadWorkerStart>) => void) | null
  postMessage(message: UploadWorkerOutput): void
}

interface UploadXhr {
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null }
  status: number
  responseText: string
  withCredentials: boolean
  onload: ((event: ProgressEvent) => void) | null
  onerror: ((event: ProgressEvent) => void) | null
  open(method: string, url: string): void
  setRequestHeader(name: string, value: string): void
  send(body: Blob): void
}

type UploadWorkerFetch = (
  input: string,
  init: RequestInit & { readonly duplex: 'half' },
) => Promise<Response>

/**
 * Self-contained Worker body; its string form becomes the Blob Worker source.
 * @param scope - Worker global used for requests and progress messages.
 * @param createXhr - XMLHttpRequest factory used for Blob progress.
 * @param doFetch - Fetch carrier used for one-shot ReadableStream bodies.
 */
export function fileUploadWorker(
  scope: UploadWorkerScope = self,
  createXhr: () => UploadXhr = () => new XMLHttpRequest(),
  doFetch: UploadWorkerFetch = (input, init) => fetch(input, init),
): void {
  scope.onmessage = (event: MessageEvent<UploadWorkerStart>) => {
    const request = event.data
    if (request.body instanceof Blob) {
      const xhr = createXhr()
      xhr.open('POST', request.url)
      xhr.withCredentials = true
      for (const [name, value] of Object.entries(request.headers)) xhr.setRequestHeader(name, value)
      xhr.upload.onprogress = (progress) => {
        scope.postMessage({
          kind: 'progress',
          loaded: progress.loaded,
          ...(progress.lengthComputable ? { total: progress.total } : {}),
        } satisfies UploadWorkerOutput)
      }
      xhr.onload = () => {
        scope.postMessage({ kind: 'complete', status: xhr.status, body: xhr.responseText } satisfies UploadWorkerOutput)
      }
      xhr.onerror = () => {
        scope.postMessage({ kind: 'error', message: 'background upload transport failed' } satisfies UploadWorkerOutput)
      }
      xhr.send(request.body)
      return
    }
    if (!(request.body instanceof ReadableStream)) {
      scope.postMessage({ kind: 'error', message: 'background upload worker received an invalid body' })
      return
    }
    const source = request.body
    void (async () => {
      const reader = source.getReader()
      let loaded = 0
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const item = await reader.read()
          if (item.done) {
            controller.close()
            return
          }
          if (!(item.value instanceof Uint8Array)) {
            throw new TypeError('background upload stream produced a non-Uint8Array chunk')
          }
          loaded += item.value.byteLength
          scope.postMessage({ kind: 'progress', loaded })
          controller.enqueue(item.value)
        },
        async cancel(reason) {
          await reader.cancel(reason)
        },
      })
      const response = await doFetch(request.url, {
        method: 'POST',
        headers: request.headers,
        credentials: 'include',
        body,
        duplex: 'half',
      })
      scope.postMessage({
        kind: 'complete',
        status: response.status,
        body: await response.text(),
      })
    })().catch((error: unknown) => {
      scope.postMessage({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    })
  }
}

interface ClientFileUploadGlobal {
  __RSH_FILE_UPLOAD__?: ClientFileUploadHooks
}

/** Carrier selected once for a page. */
export interface FileUploadTransport {
  post(request: FileUploadRequest): Promise<FileUploadResponse>
}

/** Page-owned Fetch carrier, or a dedicated Worker when the page did not install one. */
export interface SelectedFileUploadCarrier {
  readonly available: boolean
  readonly transport: FileUploadTransport
}

/**
 * Choose the carrier for this page.
 *
 * A fixture page without `__RSH_FILE_UPLOAD__` has no Host-backed carrier.
 * The hook is read once; installing it after selection does not retarget uploads.
 * @param hook - optional pre-read page hook; defaults to the global installed before boot.
 * @returns availability and the transport later uploads must use.
 */
export function selectFileUploadCarrier(hook = readFileUploadHook()): SelectedFileUploadCarrier {
  return {
    available: hook !== undefined || !isFixturePage(),
    transport: hook === undefined ? workerTransport() : customTransport(hook.fetch),
  }
}

/**
 * Read the page hook installed before either client entry boots.
 * @returns the installed hook, or `undefined` when the page did not install one.
 */
export function readFileUploadHook(): ClientFileUploadHooks | undefined {
  return (globalThis as ClientFileUploadGlobal).__RSH_FILE_UPLOAD__
}

function customTransport(customFetch: FileUploadFetch): FileUploadTransport {
  return {
    async post(request) {
      const init: RequestInit & { duplex?: 'half' } = {
        method: 'POST',
        ...(request.headers === undefined ? {} : { headers: request.headers }),
        body: request.body,
        ...(request.body instanceof ReadableStream ? { duplex: 'half' as const } : {}),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      }
      const response = await customFetch(resolveUrl(request.path), init)
      return { status: response.status, body: await response.text() }
    },
  }
}

function workerTransport(): FileUploadTransport {
  return {
    post(request) {
      if (typeof Worker !== 'function') {
        return Promise.reject(new Error('background upload requires Web Worker support'))
      }
      const workerUrl = URL.createObjectURL(new Blob([
        `(${fileUploadWorker.toString()})()`,
      ], { type: 'text/javascript' }))
      const worker = new Worker(workerUrl, { name: 'dsh-file-upload' })
      URL.revokeObjectURL(workerUrl)
      return new Promise((resolve, reject) => {
        let settled = false
        const abort = (): void => {
          settled = true
          worker.terminate()
          request.signal?.removeEventListener('abort', abort)
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        }
        const finish = (settle: () => void): void => {
          if (settled) return
          settled = true
          request.signal?.removeEventListener('abort', abort)
          worker.terminate()
          settle()
        }
        worker.onmessage = (event: MessageEvent<UploadWorkerOutput>) => {
          const output = event.data
          if (output.kind === 'progress') {
            request.onProgress?.({
              loaded: output.loaded,
              ...(output.total === undefined ? {} : { total: output.total }),
            })
          } else if (output.kind === 'complete') {
            finish(() => { resolve({ status: output.status, body: output.body }) })
          } else {
            finish(() => { reject(new Error(output.message)) })
          }
        }
        worker.onerror = (event) => {
          finish(() => { reject(new Error(event.message || 'background upload worker failed')) })
        }
        if (request.signal?.aborted === true) {
          abort()
          return
        }
        request.signal?.addEventListener('abort', abort, { once: true })
        const message: UploadWorkerStart = {
          url: resolveUrl(request.path).href,
          body: request.body,
          headers: request.headers ?? {},
        }
        if (request.body instanceof ReadableStream) worker.postMessage(message, [request.body])
        else worker.postMessage(message)
      })
    },
  }
}

function resolveUrl(path: string): URL {
  const pageLocation = Reflect.get(globalThis, 'location') as unknown
  const origin = typeof pageLocation === 'object' && pageLocation !== null
    && 'origin' in pageLocation && typeof pageLocation.origin === 'string'
    ? pageLocation.origin
    : undefined
  return new URL(path, origin === undefined || origin === 'null' ? 'http://dsh.internal' : origin)
}

function isFixturePage(): boolean {
  const pageLocation = Reflect.get(globalThis, 'location') as unknown
  return typeof pageLocation === 'object' && pageLocation !== null
    && 'search' in pageLocation && typeof pageLocation.search === 'string'
    && new URLSearchParams(pageLocation.search).has('fixture')
}
