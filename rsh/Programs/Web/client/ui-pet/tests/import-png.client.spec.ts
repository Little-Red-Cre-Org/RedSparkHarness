// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { importPetPng } from '../src/client/import-png.ts'

function png(width = 256, height = 256): File {
  const bytes = new Uint8Array(24)
  const header = new DataView(bytes.buffer)
  header.setUint32(0, 0x89504e47)
  header.setUint32(4, 0x0d0a1a0a)
  header.setUint32(12, 0x49484452)
  header.setUint32(16, width)
  header.setUint32(20, height)
  return new File([bytes], 'pet.png', { type: 'image/png' })
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('importPetPng', () => {
  it.each([{ size: 0 }, { size: 4 * 1024 * 1024 + 1 }])('rejects an invalid PNG size', async (file) => {
    await expect(importPetPng(file as File)).rejects.toThrow('Invalid pet PNG size')
  })

  it.each([
    () => new File([new Uint8Array(24)], 'pet.png'),
    () => { const file = png(); return new File([new Uint8Array(8), new Uint8Array(16)], file.name) },
    () => png(4097, 256),
    () => png(256, 4097),
  ])('rejects an invalid PNG header', async (makeFile) => {
    await expect(importPetPng(makeFile())).rejects.toThrow('Invalid pet PNG header')
  })

  it('draws four centered frames and releases the decoded bitmap', async () => {
    const close = vi.fn()
    const drawImage = vi.fn()
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ({ drawImage })), toDataURL: vi.fn(() => 'data:image/png;base64,atlas') }
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 384, height: 256, close })))
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement)

    await expect(importPetPng(png())).resolves.toBe('data:image/png;base64,atlas')
    expect(canvas).toMatchObject({ width: 768, height: 256 })
    expect(drawImage).toHaveBeenCalledTimes(4)
    expect(close).toHaveBeenCalledOnce()
  })

  it('releases the bitmap when conversion cannot obtain a canvas context', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 256, height: 256, close })))
    vi.spyOn(document, 'createElement').mockReturnValue({ getContext: () => null } as unknown as HTMLCanvasElement)

    await expect(importPetPng(png())).rejects.toThrow('PNG conversion unavailable')
    expect(close).toHaveBeenCalledOnce()
  })

  it('releases the bitmap when PNG encoding fails', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 256, height: 256, close })))
    vi.spyOn(document, 'createElement').mockReturnValue({
      getContext: () => ({ drawImage: vi.fn() }), toDataURL: () => { throw new Error('encode failed') },
    } as unknown as HTMLCanvasElement)

    await expect(importPetPng(png())).rejects.toThrow('encode failed')
    expect(close).toHaveBeenCalledOnce()
  })
})
