/**
 * The model-facing `read_image` tool commits a PNG/JPEG/WebP/GIF file. A path
 * without a file extension is identified from its file signature, while the
 * attachment service's full decode stays authoritative. The mounted `ctx.fs`
 * backend owns path resolution and read access; names only declare media type.
 *
 * The route gate is deliberately stricter than the host upload preflight. An
 * image-reading tool is useful only when the exact calling route can inspect
 * its result, so unknown capability refuses instead of relying on an adapter
 * failure after filesystem and attachment work.
 * @module @deepseek-ai/dsh-tool-fs/src/read-image
 */

import { basename, extname } from 'node:path'
import { imagePresentationMeta } from './presentation-meta.ts'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import { formatImageReadOutput, imageMediaTypeForPath, imageStorageError, sniffImageMediaType } from './read-image-core.ts'
import { resolveRegularReadTarget } from './read-target.ts'

export { formatImageReadOutput, imageMediaTypeForPath, sniffImageMediaType } from './read-image-core.ts'

const IMAGE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
    originalDimensions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
      },
    },
  },
} as const

/** The structured outcome declared by the `read_image` output schema. */
export interface ImageReadValue {
  path: string
  image: {
    attachmentId: string
    mediaType: ImageMediaType
    bytes: number
    width: number
    height: number
    name?: string
    /** Orientation-applied file dimensions before normalization; present only when storage reduced it. */
    originalDimensions?: {
      width: number
      height: number
    }
  }
}

/**
 * Enforce the strict image-capability gate for the calling route. Resolves the
 * session's latest routed provider/model (request header config, then agent
 * options) and requires the exact resolved route to declare `image` input explicitly.
 * @param ctx - the plugin context used to resolve the optional `llm` service.
 * @param exec - the tool-execution context supplying the calling agent.
 * @param requestedPath - the raw, not-yet-resolved path rendered in refusal messages.
 */
export async function assertImageCapableRoute(ctx: Context, exec: ToolExecution, requestedPath: string): Promise<void> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error(`cannot read "${requestedPath}" as an image: the current model route could not be resolved`)
  }
  const active = await llm.resolveModelInfo(provider, model, exec.signal)
  if (active.inputModalities === undefined || !active.inputModalities.includes('image')) {
    throw new Error(`cannot read "${requestedPath}" as an image: model "${model}" does not declare image input; switch to an image-capable model to read images`)
  }
}

/** Refuse a media type outside the deployment's accepted set, naming the offending path. */
function assertDeploymentAccepts(attachments: AttachmentStore, mediaType: ImageMediaType, displayPath: string): void {
  if (!attachments.imageLimits.mediaTypes.includes(mediaType)) {
    throw new Error(`cannot read "${displayPath}": ${mediaType} images are not accepted by this deployment`)
  }
}

/**
 * Re-brand a structured image outcome into the durable attachment reference an
 * `ImageBlock` carries.
 * @param image - the image metadata from the output schema.
 * @returns the branded attachment reference.
 */
export function imageRefFromValue(image: ImageReadValue['image']): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...image.name === undefined ? {} : { name: image.name },
    ...image.originalDimensions === undefined ? {} : {
      originalDimensions: { ...image.originalDimensions },
    },
  }
}

/**
 * Project one structured image read into its model-facing envelope and image.
 * @param value - the image-read outcome.
 * @returns the two content blocks used by native and nested dispatches.
 */
function imageReadContent(value: ImageReadValue): ContentBlock[] {
  return [
    { type: 'text', text: formatImageReadOutput(value.path, value.image) },
    { type: 'image', attachment: imageRefFromValue(value.image) },
  ]
}

/**
 * Register the `read_image` tool into the given context. The composing plugin
 * owns the attachments gate: `src/index.ts` calls this inside
 * `ctx.inject(['attachments'], …)` so the tool exists only while a durable
 * store is mounted. Execution still re-checks `ctx.get('attachments')` for
 * direct callers and gates on the calling route's declared image input.
 * @param ctx - the registration scope; execution uses its `fs` service plus
 *   the optional `attachments`/`llm` services.
 */
export function applyReadImageTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'read_image',
    description: 'Read a PNG/JPEG/WebP/GIF file and return the image itself. '
      + 'A path without a file extension is accepted; the format is detected from the file content, so normalized attachment paths can be passed directly without copying or renaming. '
      + 'Harness validates and downscales large supported images before the next model request, so use this tool directly instead of installing image libraries or creating thumbnails merely to inspect an image. '
      + 'Independent files may be read concurrently in small batches. Requires the current model to accept image input.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to the image file, resolved by the filesystem backend.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          image: IMAGE_VALUE_SCHEMA,
        },
      },
      render: (_args, value) => imageReadContent(value),
      // Persist the resolved path only. The attachment reference is NOT copied
      // here: the settled `content` already carries the image block with the
      // complete reference, so a second copy would keep two records of one fact —
      // and a `tools/post-execute` hook that legitimately replaces the content
      // would leave the stale copy behind, showing an image the result no longer
      // returns. The path needs its own structured record because the content
      // carries it only as model-facing envelope text, which the client does not
      // parse.
      presentationMeta: (_args, value) => imagePresentationMeta(value),
    },
    // Content-addressed attachment writes are idempotent, so concurrent reads
    // of the same file cannot conflict.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')

      // Every pre-read gate runs before any filesystem I/O so a refusal never
      // leaks partial reads or attachment writes. An extension-less path
      // declares no format, so only its format and deployment media-type
      // checks wait for the bytes.
      const extension = extname(args.file_path).toLowerCase()
      const declared = imageMediaTypeForPath(args.file_path)
      if (declared === undefined && extension !== '') {
        throw new Error(`cannot read "${args.file_path}": the ${extension} extension does not declare a supported image format; read_image accepts PNG/JPEG/WebP/GIF files, including extension-less files in those formats`)
      }
      const attachments = ctx.get('attachments')
      if (attachments === undefined) {
        throw new Error(`cannot read "${args.file_path}" as an image: no attachment service is mounted`)
      }
      if (declared !== undefined) assertDeploymentAccepts(attachments, declared, args.file_path)
      await assertImageCapableRoute(ctx, exec, args.file_path)

      const { target, info } = await resolveRegularReadTarget(ctx, exec, args.file_path)

      // The tool result is one message carrying one image, so the per-message
      // aggregate bound applies beside the per-image bound.
      const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
      const data = await ctx.fs.readBytes(target, exec.signal, byteCap)
      const mediaType = declared ?? sniffImageMediaType(data)
      if (mediaType === undefined) {
        throw new Error(`cannot read "${target.displayPath}": the file content is not a supported image format; read_image accepts PNG/JPEG/WebP/GIF`)
      }
      if (declared === undefined) assertDeploymentAccepts(attachments, mediaType, target.displayPath)
      // Persist before returning: the image block must reference a durably
      // committed object by the time the tool/result event is appended.
      let ref: ImageAttachmentRef
      try {
        ref = await attachments.saveImage({ data, mediaType, name: basename(target.displayPath) })
      } catch (error: unknown) {
        throw imageStorageError(error, target.displayPath, declared !== undefined, mediaType,
          extension, attachments.imageLimits, value => value instanceof AttachmentError)
      }
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      const value: ImageReadValue = {
        path: target.displayPath,
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...ref.name === undefined ? {} : { name: ref.name },
          ...ref.originalDimensions === undefined ? {} : {
            originalDimensions: { ...ref.originalDimensions },
          },
        },
      }
      return value
    },
    // Pure display: a generic card in the read family with a follow-along
    // location on the image file.
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Read image ${args.file_path}`,
        kind: 'read',
        locations: [{ path: args.file_path }],
      }
    },
  }))
}
