/** Native file upload: the Session route, receipt parser, and installation entry. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@redspark/rsh-session/types'
import type { ClientFileUploadHooks } from '../src/types.ts'
import {
  createNativeFileUpload, NativeFileUploadError, parseNativeFileUploadBody, plugin,
} from '../src/native.ts'
import type { FileUploadTransport } from '../src/client/carrier.ts'

interface UploadGlobal {
  __RSH_FILE_UPLOAD__?: ClientFileUploadHooks
}

const sessionId = 'session-1' as SessionId

afterEach(() => {
  delete (globalThis as UploadGlobal).__RSH_FILE_UPLOAD__
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function transport(result: { readonly status: number; readonly body: string }): FileUploadTransport & {
  readonly posts: readonly { readonly path: string; readonly body: unknown; readonly signal?: AbortSignal }[]
} {
  const posts: { path: string; body: unknown; signal?: AbortSignal }[] = []
  return {
    posts,
    async post(request) {
      posts.push({ path: request.path, body: request.body, ...(request.signal === undefined ? {} : { signal: request.signal }) })
      request.onProgress?.({ loaded: 1, total: 2 })
      return result
    },
  }
}

describe('parseNativeFileUploadBody', () => {
  it('returns the receipt the Native Session client accepts', () => {
    expect(parseNativeFileUploadBody(JSON.stringify({
      ok: true, value: { receiptId: 'receipt-1', name: 'notes.txt', bytes: 4 },
    }))).toEqual({ receiptId: 'receipt-1', name: 'notes.txt', bytes: 4 })
  })

  it('rejects malformed JSON, envelopes, failures, and receipts', () => {
    expect(() => parseNativeFileUploadBody('not-json')).toThrow(NativeFileUploadError)
    expect(() => parseNativeFileUploadBody('{}')).toThrow(/invalid result/)
    expect(() => parseNativeFileUploadBody('null')).toThrow(/invalid result/)
    expect(() => parseNativeFileUploadBody(JSON.stringify({ ok: false, error: 'nope' }))).toThrow(/invalid failure/)
    expect(() => parseNativeFileUploadBody(JSON.stringify({ ok: false, error: { code: 1, message: 'nope' } }))).toThrow(/invalid failure/)
    try {
      parseNativeFileUploadBody(JSON.stringify({ ok: false, error: { code: 'denied', message: 'no store' } }))
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(NativeFileUploadError)
      expect((error as NativeFileUploadError).code).toBe('denied')
      expect((error as NativeFileUploadError).message).toBe('no store')
    }
    expect(() => parseNativeFileUploadBody(JSON.stringify({ ok: true, value: { receiptId: '', name: 'a', bytes: 0 } }))).toThrow(/invalid receipt/)
    expect(() => parseNativeFileUploadBody(JSON.stringify({ ok: true, value: { receiptId: 'r', name: 'a', bytes: -1 } }))).toThrow(/invalid receipt/)
    expect(() => parseNativeFileUploadBody(JSON.stringify({ ok: true, value: { receiptId: 'r', name: 'a', bytes: 1.5 } }))).toThrow(/invalid receipt/)
  })
})

describe('createNativeFileUpload', () => {
  it('posts every body kind to the Native Session route and forwards progress', async () => {
    const carrier = transport({
      status: 200,
      body: JSON.stringify({ ok: true, value: { receiptId: 'receipt-1', name: 'blob.bin', bytes: 3 } }),
    })
    const service = createNativeFileUpload({ transport: carrier, available: true })
    const signal = new AbortController().signal
    const progress = vi.fn()
    const receipt = await service.upload(sessionId, new Uint8Array([1, 2, 3]), 'blob.bin', signal, progress)
    expect(receipt).toMatchObject({ receiptId: 'receipt-1', name: 'blob.bin', bytes: 3 })
    expect(carrier.posts[0]?.path).toBe('/api/native-session/file-upload?sessionId=session-1&name=blob.bin')
    expect(carrier.posts[0]?.body).toBeInstanceOf(Blob)
    expect(carrier.posts[0]?.signal).toBe(signal)
    expect(progress).toHaveBeenCalledWith({ loaded: 1, total: 2 })

    const blob = new Blob(['abc'])
    await service.upload(sessionId, blob)
    expect(carrier.posts[1]?.path).toBe('/api/native-session/file-upload?sessionId=session-1')
    expect(carrier.posts[1]?.body).toBe(blob)

    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.close() } })
    await service.upload(sessionId, stream)
    expect(carrier.posts[2]?.body).toBe(stream)
  })

  it('rejects fixture pages and non-200 responses', async () => {
    const carrier = transport({ status: 503, body: '' })
    const unavailable = createNativeFileUpload({ transport: carrier, available: false })
    await expect(unavailable.upload(sessionId, new Blob())).rejects.toThrow(/fixture mode/)
    expect(carrier.posts).toHaveLength(0)

    const failing = createNativeFileUpload({ transport: carrier, available: true })
    await expect(failing.upload(sessionId, new Blob())).rejects.toMatchObject({
      name: 'NativeFileUploadError', code: 'transport',
    })
  })

  it('uses the page hook when the caller does not supply a carrier', async () => {
    vi.stubGlobal('location', { origin: 'https://harness.test' })
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      ok: true, value: { receiptId: 'receipt-2', name: 'hook.txt', bytes: 1 },
    }), { status: 200 })))
    ;(globalThis as UploadGlobal).__RSH_FILE_UPLOAD__ = { fetch }
    const service = createNativeFileUpload()
    expect(service.available).toBe(true)
    await expect(service.upload(sessionId, new Blob(['x']), 'hook.txt')).resolves.toMatchObject({
      receiptId: 'receipt-2', name: 'hook.txt', bytes: 1,
    })
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://harness.test/api/native-session/file-upload?sessionId=session-1&name=hook.txt'),
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

describe('plugin', () => {
  it('provides clientFileUpload and refuses configuration', () => {
    expect(plugin.requires).toEqual([])
    expect(plugin.optional).toEqual([])
    expect(plugin.provides).toEqual(['clientFileUpload'])
    expect(() => plugin.resolve({ extra: true })).toThrow(/no configuration/)
    const provided: unknown[] = []
    const activate = plugin.resolve(undefined)
    activate({
      provide: (_name, value) => { provided.push(value); return () => {} },
    } as never)
    expect(provided).toHaveLength(1)
    expect(provided[0]).toMatchObject({ available: true })
  })
})
