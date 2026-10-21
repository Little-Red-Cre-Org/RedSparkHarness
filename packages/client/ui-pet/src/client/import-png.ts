/** Decode a bounded user PNG into the four-frame atlas used by pet presenters. */

/**
 * Convert a single character illustration into a transparent atlas with four identical frames.
 * @param file - User-selected PNG, at most 4 MiB and 4096 pixels per side.
 * @returns a PNG data URL independent of the original file path.
 */
export async function importPetPng(file: File): Promise<string> {
  if (file.size > 4 * 1024 * 1024 || file.size < 24) throw new Error('Invalid pet PNG size')
  const header = new DataView(await file.slice(0, 24).arrayBuffer())
  if (header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a
    || header.getUint32(12) !== 0x49484452 || header.getUint32(16) > 4096 || header.getUint32(20) > 4096) {
    throw new Error('Invalid pet PNG header')
  }
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 768
    canvas.height = 256
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('PNG conversion unavailable')
    const scale = Math.min(192 / bitmap.width, 256 / bitmap.height)
    const width = bitmap.width * scale
    const height = bitmap.height * scale
    for (let frame = 0; frame < 4; frame++) {
      context.drawImage(bitmap, frame * 192 + (192 - width) / 2, 256 - height, width, height)
    }
    return canvas.toDataURL('image/png')
  } finally { bitmap.close() }
}
