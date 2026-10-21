import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

const sharpCalls = vi.hoisted(() => ({ inputs: [] as unknown[], reportedFormat: undefined as string | undefined }))

vi.mock('sharp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sharp')>()
  const recorded = ((...args: Parameters<typeof actual.default>) => {
    sharpCalls.inputs.push(args[0])
    const instance = actual.default(...args)
    const reportedFormat = sharpCalls.reportedFormat
    if (reportedFormat !== undefined) {
      const metadata = instance.metadata.bind(instance)
      instance.metadata = (async () => ({ ...await metadata(), format: reportedFormat })) as typeof instance.metadata
    }
    return instance
  }) as typeof actual.default
  return { ...actual, default: Object.assign(recorded, actual.default) }
})

import sharp from 'sharp'
import { detectImage, probeImage } from '../src/image.ts'
import { normalizeImage } from '../src/normalization.ts'
import { openSupportedImage, sniffImageMediaType } from '../src/signature.ts'

const SUPPORTED = [
  ['png', 'image/png'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['gif', 'image/gif'],
] as const

async function raster(format: 'png' | 'jpeg' | 'webp' | 'gif'): Promise<Uint8Array> {
  const encoded = new Uint8Array(await sharp({
    create: { width: 3, height: 2, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
  }).toFormat(format).toBuffer())
  sharpCalls.inputs.length = 0
  return encoded
}

/** An ISO-BMFF `ftyp` box naming the given major brand, as HEIF and AVIF files begin. */
function ftypBox(brand: string): Uint8Array {
  const box = Buffer.alloc(32)
  box.writeUInt32BE(box.byteLength, 0)
  box.write('ftyp', 4, 'latin1')
  box.write(brand, 8, 'latin1')
  box.write(`mif1${brand}miaf`, 16, 'latin1')
  return new Uint8Array(box)
}

/** Random bytes whose first byte cannot begin any supported signature. */
function randomPayload(): Uint8Array {
  const bytes = new Uint8Array(randomBytes(256))
  bytes[0] = 0x00
  return bytes
}

const REJECTED: ReadonlyArray<readonly [string, Uint8Array]> = [
  ['SVG text', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')],
  ['XML-prefixed SVG text', new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')],
  ['HEIF ftyp box', ftypBox('heic')],
  ['AVIF ftyp box', ftypBox('avif')],
  ['TIFF header', Uint8Array.of(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00)],
  ['RIFF container that is not WebP', new Uint8Array(Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1'))],
  ['truncated PNG signature', Uint8Array.of(0x89, 0x50, 0x4e, 0x47)],
  ['empty input', new Uint8Array()],
  ['random bytes', randomPayload()],
]

afterEach(() => {
  sharpCalls.inputs.length = 0
  sharpCalls.reportedFormat = undefined
})

describe('image signature allow-list', () => {
  it('passes PNG, JPEG, WebP, and GIF bytes to Sharp', async () => {
    for (const [format, mediaType] of SUPPORTED) {
      const data = await raster(format)
      expect(sniffImageMediaType(data)).toBe(mediaType)
      await expect(detectImage(data)).resolves.toMatchObject({ mediaType, width: 3, height: 2 })
      await expect(probeImage(data)).resolves.toMatchObject({ mediaType, width: 3, height: 2 })
      expect(sharpCalls.inputs).toEqual([data, data])
      sharpCalls.inputs.length = 0
    }
  })

  it('recognizes both GIF signature versions', () => {
    expect(sniffImageMediaType(new Uint8Array(Buffer.from('GIF87a', 'latin1')))).toBe('image/gif')
    expect(sniffImageMediaType(new Uint8Array(Buffer.from('GIF89a', 'latin1')))).toBe('image/gif')
  })

  it.each(REJECTED)('rejects %s before Sharp parses it', async (_name, data) => {
    expect(sniffImageMediaType(data)).toBeUndefined()
    expect(() => openSupportedImage(data)).toThrow(expect.objectContaining({ code: 'INVALID_IMAGE' }))
    await expect(detectImage(data)).rejects.toMatchObject({ code: 'INVALID_IMAGE', message: 'Unsupported or malformed image data.' })
    await expect(probeImage(data)).rejects.toMatchObject({ code: 'INVALID_IMAGE', message: 'Unsupported or malformed image data.' })
    expect(sharpCalls.inputs).toEqual([])
  })

  it('rejects a supported signature whose body Sharp cannot parse', async () => {
    const signedJunk = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3)
    await expect(probeImage(signedJunk)).rejects.toMatchObject({ code: 'INVALID_IMAGE', message: 'Unsupported or malformed image data.' })
    await expect(detectImage(signedJunk)).rejects.toMatchObject({ code: 'INVALID_IMAGE', message: 'Unsupported or malformed image data.' })
    expect(sharpCalls.inputs).toEqual([signedJunk, signedJunk])
  })

  it('rejects a decoder-reported format outside the allow-list', async () => {
    const data = await raster('png')
    sharpCalls.reportedFormat = 'svg'
    await expect(probeImage(data)).rejects.toMatchObject({ code: 'INVALID_IMAGE', message: 'Unsupported or malformed image data.' })
    await expect(detectImage(data)).rejects.toMatchObject({ code: 'INVALID_IMAGE', message: 'Unsupported or malformed image data.' })
  })

  it('rejects unsupported bytes at normalization without calling Sharp', async () => {
    const detected = await detectImage(await raster('png'))
    sharpCalls.inputs.length = 0
    await expect(normalizeImage(ftypBox('avif'), { ...detected, carriesMetadata: true }, {
      maxPixels: 16,
      maxDimension: 16,
      maxBytes: 1024,
    })).rejects.toMatchObject({ code: 'INVALID_IMAGE' })
    expect(sharpCalls.inputs).toEqual([])
  })
})
