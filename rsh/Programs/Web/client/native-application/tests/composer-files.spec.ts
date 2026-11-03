// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  classifyAttachments, DEFAULT_MAX_FILE_BYTES, DEFAULT_MAX_FILES_PER_MESSAGE,
  pruneStagedFiles, railForFile, settleUpload, stagedFileReady,
  type ImageLimits, type StagedFileDraft,
} from '../src/composer-files.ts'

const LIMITS: ImageLimits = {
  maxImageBytes: 1024,
  maxImagesPerMessage: 2,
  maxMessageImageBytes: 2048,
  maxImagePixels: 640_000,
  maxImageDimension: 4096,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
}

/** Build a File without touching the real filesystem. */
function file(name: string, size = 8, type = 'text/plain', lastModified = 1_000): File {
  return new File([new Uint8Array(size)], name, { type, lastModified })
}

const EMPTY_HELD = { images: [] as readonly File[], files: [] as readonly File[] }

describe('rail assignment', () => {
  it('sends a Provider raster type to the image rail', () => {
    expect(railForFile(file('a.png', 8, 'image/png'), LIMITS)).toBe('image')
    expect(railForFile(file('a.gif', 8, 'image/gif'), LIMITS)).toBe('image')
  })

  it('sends every other type to the file rail', () => {
    expect(railForFile(file('a.pdf', 8, 'application/pdf'), LIMITS)).toBe('file')
    expect(railForFile(file('a.png', 8, 'image/svg+xml'), LIMITS)).toBe('file')
    expect(railForFile(file('a.txt', 8, 'text/plain'), LIMITS)).toBe('file')
  })

  it('treats everything as a file when the Host advertises no image policy', () => {
    expect(railForFile(file('a.png', 8, 'image/png'), undefined)).toBe('file')
  })
})

describe('batch classification', () => {
  it('splits one batch across both rails', () => {
    const batch = classifyAttachments(
      [file('shot.png', 8, 'image/png'), file('notes.md', 8, 'text/markdown')], EMPTY_HELD, LIMITS)
    expect(batch.images.map(entry => entry.name)).toEqual(['shot.png'])
    expect(batch.files.map(entry => entry.name)).toEqual(['notes.md'])
    expect(batch.rejected).toEqual([])
  })

  it('leaves image byte and count rules to the image rail', () => {
    // 4096 bytes is over maxImageBytes, but the image rail already enforces that;
    // re-checking here would let the two rules disagree.
    const batch = classifyAttachments([file('big.png', 4096, 'image/png')], EMPTY_HELD, LIMITS)
    expect(batch.images.map(entry => entry.name)).toEqual(['big.png'])
    expect(batch.rejected).toEqual([])
  })

  it('accepts a file exactly at the byte ceiling and rejects one past it', () => {
    const exact = classifyAttachments([file('a.bin', 100)], EMPTY_HELD, LIMITS, { maxFileBytes: 100 })
    expect(exact.files).toHaveLength(1)
    const past = classifyAttachments([file('b.bin', 101)], EMPTY_HELD, LIMITS, { maxFileBytes: 100 })
    expect(past.files).toHaveLength(0)
    expect(past.rejected).toEqual(['rejectedFileSize'])
  })

  it('accepts a batch exactly at the count ceiling and rejects the next file', () => {
    const input = [file('1.bin'), file('2.bin'), file('3.bin')]
    const batch = classifyAttachments(input, EMPTY_HELD, LIMITS, { maxFilesPerMessage: 2 })
    expect(batch.files.map(entry => entry.name)).toEqual(['1.bin', '2.bin'])
    expect(batch.rejected).toEqual(['rejectedFileCount'])
  })

  it('counts files already held against the ceiling', () => {
    const held = { images: [], files: [file('old.bin')] }
    const batch = classifyAttachments([file('new.bin')], held, LIMITS, { maxFilesPerMessage: 1 })
    expect(batch.files).toHaveLength(0)
    expect(batch.rejected).toEqual(['rejectedFileCount'])
  })

  it('drops a repeat of a file already held on either rail', () => {
    const shot = file('shot.png', 8, 'image/png')
    const notes = file('notes.md', 8, 'text/markdown')
    const batch = classifyAttachments([shot, notes], { images: [shot], files: [notes] }, LIMITS)
    expect(batch.images).toHaveLength(0)
    expect(batch.files).toHaveLength(0)
    expect(batch.rejected).toEqual(['rejectedDuplicate'])
  })

  it('drops a repeat inside one batch', () => {
    const batch = classifyAttachments([file('a.md'), file('a.md')], EMPTY_HELD, LIMITS)
    expect(batch.files).toHaveLength(1)
    expect(batch.rejected).toEqual(['rejectedDuplicate'])
  })

  it('keeps two same-named files that differ in content size or mtime', () => {
    const first = file('a.md', 8, 'text/markdown', 1_000)
    const second = file('a.md', 9, 'text/markdown', 1_000)
    const third = file('a.md', 8, 'text/markdown', 2_000)
    const batch = classifyAttachments([first, second, third], EMPTY_HELD, LIMITS)
    expect(batch.files).toHaveLength(3)
  })

  it('rejects a zero-byte drop', () => {
    const batch = classifyAttachments([file('empty.bin', 0)], EMPTY_HELD, LIMITS)
    expect(batch.files).toHaveLength(0)
    expect(batch.rejected).toEqual(['rejectedEmpty'])
  })

  it('reports each rejection reason once, in first-seen order', () => {
    const batch = classifyAttachments(
      [file('empty.bin', 0), file('huge.bin', 500), file('empty.bin', 0)], EMPTY_HELD, LIMITS,
      { maxFileBytes: 100 })
    expect(batch.rejected).toEqual(['rejectedEmpty', 'rejectedFileSize'])
  })

  it('exposes defaults documented as front-end values', () => {
    expect(DEFAULT_MAX_FILE_BYTES).toBe(32 * 1024 * 1024)
    expect(DEFAULT_MAX_FILES_PER_MESSAGE).toBe(10)
  })
})

describe('staged upload drafts', () => {
  const notes = file('notes.md')
  const other = file('other.md')

  it('records the receipt once the Host accepts the upload', () => {
    const settled = settleUpload([{ file: notes, uploading: true }], notes, { receiptId: 'r-1' })
    expect(settled).toEqual([{ file: notes, receiptId: 'r-1' }])
    expect(stagedFileReady(settled[0]!)).toBe(true)
  })

  it('keeps the draft when the Host refuses the upload, so retry needs no re-pick', () => {
    const settled = settleUpload([{ file: notes, uploading: true }], notes, { error: 'hostRefused' })
    expect(settled).toHaveLength(1)
    expect(settled[0]!.file).toBe(notes)
    expect(settled[0]!.error).toBe('hostRefused')
    expect(stagedFileReady(settled[0]!)).toBe(false)
  })

  it('leaves other drafts untouched when one settles', () => {
    const drafts: readonly StagedFileDraft[] = [{ file: notes }, { file: other }]
    const settled = settleUpload(drafts, notes, { receiptId: 'r-2' })
    expect(settled[1]).toEqual({ file: other })
  })

  it('is not ready while the upload is still in flight', () => {
    expect(stagedFileReady({ file: notes, uploading: true })).toBe(false)
  })

  it('prunes drafts the operator removed from the rail', () => {
    const drafts: readonly StagedFileDraft[] = [
      { file: notes, receiptId: 'r-1' },
      { file: other, receiptId: 'r-2' },
    ]
    expect(pruneStagedFiles(drafts, [other])).toEqual([{ file: other, receiptId: 'r-2' }])
  })
})
