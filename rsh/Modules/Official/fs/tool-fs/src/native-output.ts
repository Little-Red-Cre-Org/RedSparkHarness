/** Canonical native filesystem results and their existing model presentations. */
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment/types'
import type { NativeValueToolContribution } from '@deepseek-ai/dsh-native-tools'
import type { FsWriteOutcome } from '@deepseek-ai/dsh-fs/native'
import { formatReadOutput, type FileReadOutcome } from './read-render.ts'
import { formatImageReadOutput } from './read-image-core.ts'
import { formatEditOutput, formatWriteOutput, parseReadArgs } from './text-operations.ts'
import { diffPresentationMeta, imagePresentationMeta, readPresentationMeta } from './presentation-meta.ts'

/**
 * Build the text-read output using the installation's validated default line cap.
 * @param limit - configured default and maximum number of lines.
 * @returns canonical read schema and model presentation.
 */
export function nativeReadOutput(limit: number): NativeValueToolContribution['output'] {
  return {
    schema: {
      type: 'object', properties: {
        path: { type: 'string' }, offset: { type: 'integer' }, totalLines: { type: 'integer' },
        lines: { type: 'array', items: { type: 'object', properties: {
          number: { type: 'integer' }, text: { type: 'string' },
        }, required: ['number', 'text'], additionalProperties: false } },
      }, required: ['path', 'offset', 'lines', 'totalLines'], additionalProperties: false,
    },
    render(call, canonical) {
      const value = canonical as unknown as FileReadOutcome & { path: string }
      const input = parseReadArgs(call.arguments as { file_path: string; offset?: number; limit?: number }, limit)
      const endLine = value.lines.at(-1)?.number ?? Math.max(0, value.offset - 1)
      const truncatedByBytes = value.lines.length < input.limit && endLine < value.totalLines
      return { content: [{ type: 'text', text: formatReadOutput(value.path, {
        offset: value.offset, lines: value.lines, totalLines: value.totalLines,
        ...truncatedByBytes ? { truncatedByBytes: true } : {},
      }) }], isError: false, meta: readPresentationMeta(value) }
    },
  }
}

/** Canonical write outcome without the Provider's internal version token. */
export const nativeWriteOutput: NativeValueToolContribution['output'] = {
  schema: {
    type: 'object', properties: {
      path: { type: 'string' }, operation: { type: 'string', enum: ['create', 'update'] },
      before: { oneOf: [{ type: 'string' }, { type: 'null' }] }, after: { type: 'string' },
    }, required: ['path', 'operation', 'before', 'after'], additionalProperties: false,
  },
  render(call, canonical) {
    const value = canonical as unknown as Pick<FsWriteOutcome, 'operation' | 'before' | 'after'> & { path: string }
    const args = call.arguments as { file_path: string }
    const meta = diffPresentationMeta(args.file_path, value.before, value.after)
    return { content: [{ type: 'text', text: formatWriteOutput(value.path, value) }], isError: false,
      ...meta.diffs.length === 0 ? {} : { meta } }
  },
}

/** Canonical edit outcome retaining the before and after text for program consumers. */
export const nativeEditOutput: NativeValueToolContribution['output'] = {
  schema: {
    type: 'object', properties: { path: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' } },
    required: ['path', 'before', 'after'], additionalProperties: false,
  },
  render(call, canonical) {
    const value = canonical as { path: string; before: string; after: string }
    const args = call.arguments as { file_path: string; replace_all?: boolean }
    const meta = diffPresentationMeta(args.file_path, value.before, value.after)
    return { content: [{ type: 'text', text: formatEditOutput(value.path, args.replace_all ?? false) }], isError: false,
      ...meta.diffs.length === 0 ? {} : { meta } }
  },
}

/** Canonical image read retains the same durable reference used in its model-visible image block. */
export const nativeImageOutput: NativeValueToolContribution['output'] = {
  schema: {
    type: 'object', properties: {
      path: { type: 'string' }, image: { type: 'object', properties: {
        attachmentId: { type: 'string' }, mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
        bytes: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' }, name: { type: 'string' },
        originalDimensions: { type: 'object', properties: { width: { type: 'integer' }, height: { type: 'integer' } },
          required: ['width', 'height'], additionalProperties: false },
      }, required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'], additionalProperties: false },
    }, required: ['path', 'image'], additionalProperties: false,
  },
  render(_call, canonical) {
    const value = canonical as unknown as { path: string; image: ImageAttachmentRef }
    return { content: [
      { type: 'text', text: formatImageReadOutput(value.path, value.image) },
      { type: 'image', attachment: value.image },
    ], isError: false, meta: imagePresentationMeta(value) }
  },
}
