/** Native read, write, and edit contributions over the selected filesystem and observation policy. */
import { basename, extname, isAbsolute } from 'node:path'
import type { NativeContext, NativePlugin, NativeScope } from '@deepseek-ai/dsh-native-runtime'
import { FsError, type FileSystemOperations, type FsTarget, type FsWriteIntent } from '@deepseek-ai/dsh-fs/native'
import type {} from '@deepseek-ai/dsh-attachment/native'
import type { AttachmentOperations } from '@deepseek-ai/dsh-attachment/native'
import type {} from '@deepseek-ai/dsh-native-model-execution/native'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import type {} from '@deepseek-ai/dsh-native-sandbox-policy/native'
import type {} from '@deepseek-ai/dsh-native-approval/native'
import type {} from '@deepseek-ai/dsh-native-prompt/native'
import type { NativeValueToolContribution, NativeToolExecution } from '@deepseek-ai/dsh-native-tools'
import {
  ESCALATION_TARGETS, approveEscalation, escalationHintMarker, sandboxDenialMarker, validateEscalationArgs,
  type SandboxExecutionPolicy, type SandboxMode,
} from '@deepseek-ai/dsh-sandbox/native'
import { buildWindow, READ_MAX_BYTES, READ_MAX_LINE_LENGTH } from './read-render.ts'
import { imageMediaTypeForPath, imageStorageError, sniffImageMediaType } from './read-image-core.ts'
import { nativeEditOutput, nativeImageOutput, nativeReadOutput, nativeWriteOutput } from './native-output.ts'
import { remediateFsError } from './error.ts'
import {
  EDIT_GUIDANCE, parseEditArgs, parseReadArgs, parseWriteArgs,
  READ_GUIDANCE, READ_LIMIT, STREAM_MIN_SIZE, writeGuidance,
} from './text-operations.ts'

function nativeMutationError(error: unknown, displayPath: string, mode?: SandboxMode): unknown {
  if (mode === undefined || !(error instanceof FsError) || error.code !== 'FS_SANDBOX_DENIED') {
    return remediateFsError(error, displayPath)
  }
  return remediateFsError(error, displayPath,
    `${sandboxDenialMarker(mode)}\n${escalationHintMarker('operation')}`)
}

interface ReadCaps {
  readonly limit: number
  readonly maxLineLength: number
  readonly maxBytes: number
  readonly streamMinSize: number
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`tool-fs: ${name} must be a positive integer`)
  }
  return value
}

function resolveConfig(input: unknown): ReadCaps {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    throw new Error('tool-fs: native configuration must be an object')
  }
  const fields = input as Record<string, unknown> | undefined
  for (const key of Object.keys(fields ?? {})) {
    if (!['readLimit', 'readMaxLineLength', 'readMaxBytes', 'readStreamMinSize'].includes(key)) {
      throw new Error(`tool-fs: unknown native configuration field ${key}`)
    }
  }
  return {
    limit: positiveInteger(fields?.readLimit ?? READ_LIMIT, 'readLimit'),
    maxLineLength: positiveInteger(fields?.readMaxLineLength ?? READ_MAX_LINE_LENGTH, 'readMaxLineLength'),
    maxBytes: positiveInteger(fields?.readMaxBytes ?? READ_MAX_BYTES, 'readMaxBytes'),
    streamMinSize: positiveInteger(fields?.readStreamMinSize ?? STREAM_MIN_SIZE, 'readStreamMinSize'),
  }
}

function argumentsObject(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('tool-fs: tool arguments must be an object')
  }
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (!allowed.includes(key)) throw new Error(`tool-fs: unexpected argument ${key}`)
  }
  return fields
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`tool-fs: ${name} must be a string`)
  return value
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, name)
}

interface EscalationArgs {
  readonly sandbox_permissions?: string
  readonly justification?: string
}

function escalationArgs(fields: Record<string, unknown>): EscalationArgs {
  const sandbox_permissions = optionalString(fields.sandbox_permissions, 'sandbox_permissions')
  const justification = optionalString(fields.justification, 'justification')
  validateEscalationArgs(sandbox_permissions, justification)
  return {
    ...sandbox_permissions === undefined ? {} : { sandbox_permissions },
    ...justification === undefined ? {} : { justification },
  }
}

function escalationSchema(fs: FileSystemOperations): Record<string, unknown> {
  return fs.sandboxMode === undefined ? {} : {
    sandbox_permissions: {
      type: 'string', enum: [...ESCALATION_TARGETS],
      description: 'The wider sandbox mode this file operation needs. Only valid as a one-shot retry '
        + 'of an operation the sandbox just denied; requires justification and user approval.',
    },
    justification: {
      type: 'string', description: 'Required with sandbox_permissions: one sentence for the user explaining '
        + 'why this exact file operation needs the wider access.',
    },
  }
}

async function mutationPolicy(
  context: NativeContext, fs: FileSystemOperations, call: NativeToolExecution, args: EscalationArgs,
  reason: string,
): Promise<SandboxExecutionPolicy | undefined> {
  const standing = context.optional('sandboxPolicy')?.resolve({ session: call.session })
  if (args.sandbox_permissions === undefined || args.justification === undefined) {
    if (context.optional('approval') !== undefined) {
      if (call.authorize === undefined) throw new Error(`native-tools: tool ${call.name} requires an approval authority`)
      await call.authorize({ reason }, call.signal)
    }
    return standing
  }
  if (fs.sandboxMode === undefined) {
    throw new Error('sandbox_permissions is not available in this composition (no sandboxing filesystem to escalate)')
  }
  if (standing === undefined) throw new Error('tool-fs: the mounted filesystem confines but sandboxPolicy is missing')
  const requestApproval = call.requestApproval
  const mode = await approveEscalation(
    { requestedMode: args.sandbox_permissions, justification: args.justification,
      effectiveMode: standing.mode, subject: 'operation' },
    { approver: requestApproval === undefined ? undefined : {
      request: ({ reason: requestedReason }) => requestApproval({ reason: requestedReason }, call.signal),
    }, agent: call.agent, callId: call.callId, toolName: call.name, signal: call.signal },
  )
  return { ...standing, mode }
}

function actor(call: NativeToolExecution): { agent: { session: object } } {
  return { agent: { session: call.session } }
}

async function target(fs: FileSystemOperations, call: NativeToolExecution, path: string, allowOutside = false): Promise<FsTarget> {
  const cwd = call.session.header.cwd
  if (cwd === undefined || !isAbsolute(cwd)) throw new Error('tool-fs: Session has no absolute workspace')
  const root = await fs.resolve(cwd, { signal: call.signal })
  const rootInfo = await fs.stat(root, call.signal)
  if (rootInfo?.type !== 'directory') throw new Error('tool-fs: Session workspace is not a directory')
  const resolved = await fs.resolve(path, { cwd, signal: call.signal })
  if (!allowOutside && !fs.contains(root, resolved)) throw new FsError(`path outside workspace: ${path}`, 'FS_SANDBOX_DENIED')
  return resolved
}

function readTool(context: NativeContext, fs: FileSystemOperations, caps: ReadCaps): NativeValueToolContribution {
  return {
    schema: {
      name: 'read', description: 'Read a UTF-8 text file and return line-numbered content.',
      parameters: { type: 'object', properties: {
        file_path: { type: 'string', description: 'Path to read, resolved by the filesystem backend.' },
        offset: { type: 'number', description: '1-based first line to return. Defaults to 1.' },
        limit: { type: 'number', description: `Maximum number of lines to return. Defaults to ${caps.limit}.` },
      }, required: ['file_path'], additionalProperties: false },
    },
    output: nativeReadOutput(caps.limit),
    isConcurrencySafe: () => true,
    async execute(call) {
      const fields = argumentsObject(call.arguments, ['file_path', 'offset', 'limit'])
      const filePath = requiredString(fields.file_path, 'file_path')
      if (fields.offset !== undefined && typeof fields.offset !== 'number') throw new Error('tool-fs: offset must be a number')
      if (fields.limit !== undefined && typeof fields.limit !== 'number') throw new Error('tool-fs: limit must be a number')
      const input = parseReadArgs({ file_path: filePath,
        ...fields.offset === undefined ? {} : { offset: fields.offset },
        ...fields.limit === undefined ? {} : { limit: fields.limit },
      }, caps.limit)
      const resolved = await target(fs, call, input.filePath)
      const info = await fs.stat(resolved, call.signal)
      if (info === undefined) {
        context.events.emit(context.scope, 'fs/observed', resolved, { kind: 'absent' }, actor(call))
        throw new FsError(`cannot read "${resolved.displayPath}": not found`, 'FS_NOT_FOUND')
      }
      if (info.type !== 'file') throw new FsError(`cannot read "${resolved.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      const chunks = info.size === undefined || info.size >= caps.streamMinSize
        ? await fs.streamText(resolved, call.signal)
        : [await fs.readText(resolved, call.signal)]
      const window = await buildWindow(chunks, {
        offset: input.offset, limit: input.limit, maxLineLength: caps.maxLineLength, maxBytes: caps.maxBytes,
      }, resolved.displayPath)
      context.events.emit(context.scope, 'fs/observed', resolved, { kind: 'present', version: info.version }, actor(call))
      return { path: resolved.displayPath, offset: input.offset, lines: window.lines, totalLines: window.totalLines }
    },
  }
}

function readImageTool(context: NativeContext, fs: FileSystemOperations, attachments: AttachmentOperations): NativeValueToolContribution {
  return {
    schema: {
      name: 'read_image',
      description: 'Read a PNG/JPEG/WebP/GIF file and return the image itself. The current model must declare image input.',
      parameters: { type: 'object', properties: {
        file_path: { type: 'string', description: 'Path to the image file, resolved by the filesystem backend.' },
      }, required: ['file_path'], additionalProperties: false },
    },
    output: nativeImageOutput,
    isConcurrencySafe: () => true,
    async execute(call) {
      const fields = argumentsObject(call.arguments, ['file_path'])
      const filePath = requiredString(fields.file_path, 'file_path')
      if (filePath.trim().length === 0) throw new Error('file_path must be a non-empty string')
      const extension = extname(filePath).toLowerCase()
      const declared = imageMediaTypeForPath(filePath)
      if (declared === undefined && extension !== '') {
        throw new Error(`cannot read "${filePath}": the ${extension} extension does not declare a supported image format; read_image accepts PNG/JPEG/WebP/GIF files, including extension-less files in those formats`)
      }
      if (declared !== undefined && !attachments.imageLimits.mediaTypes.includes(declared)) {
        throw new Error(`cannot read "${filePath}": ${declared} images are not accepted by this deployment`)
      }
      const route = call.session.requestHeader()?.config
      const model = context.optional('model')
      if (route === undefined || model?.resolveModel === undefined) {
        throw new Error(`cannot read "${filePath}" as an image: the current model route could not be resolved`)
      }
      const info = await model.resolveModel(route.provider, route.model, call.signal)
      if (info.inputModalities === undefined || !info.inputModalities.includes('image')) {
        throw new Error(`cannot read "${filePath}" as an image: model "${route.model}" does not declare image input; switch to an image-capable model to read images`)
      }
      const resolved = await target(fs, call, filePath)
      const stat = await fs.stat(resolved, call.signal)
      if (stat === undefined) {
        context.events.emit(context.scope, 'fs/observed', resolved, { kind: 'absent' }, actor(call))
        throw new FsError(`cannot read "${resolved.displayPath}": not found`, 'FS_NOT_FOUND')
      }
      if (stat.type !== 'file') {
        throw new FsError(`cannot read "${resolved.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      }
      const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
      const data = await fs.readBytes(resolved, call.signal, byteCap)
      const mediaType = declared ?? sniffImageMediaType(data)
      if (mediaType === undefined) {
        throw new Error(`cannot read "${resolved.displayPath}": the file content is not a supported image format; read_image accepts PNG/JPEG/WebP/GIF`)
      }
      if (declared === undefined && !attachments.imageLimits.mediaTypes.includes(mediaType)) {
        throw new Error(`cannot read "${resolved.displayPath}": ${mediaType} images are not accepted by this deployment`)
      }
      let ref
      try {
        ref = await attachments.saveImage({ data, mediaType, name: basename(resolved.displayPath) })
      } catch (error: unknown) {
        throw imageStorageError(error, resolved.displayPath, declared !== undefined, mediaType,
          extension, attachments.imageLimits, value => attachments.isAttachmentError(value))
      }
      context.events.emit(context.scope, 'fs/observed', resolved, { kind: 'present', version: stat.version }, actor(call))
      return { path: resolved.displayPath, image: ref }
    },
  }
}

function writeTool(context: NativeContext, fs: FileSystemOperations): NativeValueToolContribution {
  return {
    schema: {
      name: 'write', description: 'Create or fully replace a UTF-8 text file.',
      parameters: { type: 'object', properties: {
        file_path: { type: 'string', description: 'Path to write, resolved by the filesystem backend.' },
        content: { type: 'string', description: 'Full UTF-8 text content to write.' },
        ...escalationSchema(fs),
      },
      required: ['file_path', 'content'], additionalProperties: false },
    },
    output: nativeWriteOutput,
    async execute(call) {
      const fields = argumentsObject(call.arguments, ['file_path', 'content', 'sandbox_permissions', 'justification'])
      const input = parseWriteArgs({ file_path: requiredString(fields.file_path, 'file_path'), content: requiredString(fields.content, 'content') })
      const sandboxPolicy = await mutationPolicy(context, fs, call, escalationArgs(fields),
        'Writing a file changes the selected workspace.')
      const resolved = await target(fs, call, input.filePath, fs.sandboxMode !== undefined)
      let outcome
      try {
        const intent = await context.events.waterfall(context.scope, 'fs/write-intent', (): FsWriteIntent | undefined => undefined,
          resolved, actor(call))
        if (intent === undefined) throw new Error('tool-fs: observation policy did not supply write intent')
        outcome = await fs.writeText(resolved, input.content, intent, call.signal, sandboxPolicy)
      } catch (error: unknown) {
        throw nativeMutationError(error, resolved.displayPath, sandboxPolicy?.mode)
      }
      context.events.emit(context.scope, 'fs/observed', resolved, { kind: 'present', version: outcome.version }, actor(call))
      return { path: resolved.displayPath, operation: outcome.operation, before: outcome.before, after: outcome.after }
    },
  }
}

function editTool(context: NativeContext, fs: FileSystemOperations): NativeValueToolContribution {
  return {
    schema: {
      name: 'edit', description: 'Edit an existing UTF-8 text file by replacing literal text.',
      parameters: { type: 'object', properties: {
        file_path: { type: 'string', description: 'Path to edit, resolved by the filesystem backend.' },
        old_string: { type: 'string', description: 'Literal text to replace. Must match exactly.' },
        new_string: { type: 'string', description: 'Literal replacement text. Use an empty string to delete the match.' },
        replace_all: { type: 'boolean', description: 'Replace all matches. Defaults to false; when false, old_string must appear exactly once.' },
        ...escalationSchema(fs),
      }, required: ['file_path', 'old_string', 'new_string'], additionalProperties: false },
    },
    output: nativeEditOutput,
    async execute(call) {
      const fields = argumentsObject(call.arguments, ['file_path', 'old_string', 'new_string', 'replace_all',
        'sandbox_permissions', 'justification'])
      if (fields.replace_all !== undefined && typeof fields.replace_all !== 'boolean') {
        throw new Error('tool-fs: replace_all must be a boolean')
      }
      const input = parseEditArgs({
        file_path: requiredString(fields.file_path, 'file_path'),
        old_string: requiredString(fields.old_string, 'old_string'),
        new_string: requiredString(fields.new_string, 'new_string'),
        ...fields.replace_all === undefined ? {} : { replace_all: fields.replace_all },
      })
      const sandboxPolicy = await mutationPolicy(context, fs, call, escalationArgs(fields),
        'Editing a file changes the selected workspace.')
      const resolved = await target(fs, call, input.filePath, fs.sandboxMode !== undefined)
      let outcome
      try {
        const intent = await context.events.waterfall(context.scope, 'fs/edit-intent', () => undefined, resolved, actor(call))
        if (intent === undefined) throw new Error('tool-fs: observation policy did not supply edit intent')
        outcome = await fs.editText(resolved, {
          oldString: input.oldString, newString: input.newString, replaceAll: input.replaceAll,
        }, intent, call.signal, sandboxPolicy)
      } catch (error: unknown) {
        throw nativeMutationError(error, resolved.displayPath, sandboxPolicy?.mode)
      }
      context.events.emit(context.scope, 'fs/observed', resolved, { kind: 'present', version: outcome.version }, actor(call))
      return { path: resolved.displayPath, before: outcome.before, after: outcome.after }
    },
  }
}

/** Register one native file-tool suite; each contribution leaves with this installation. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-tool-fs', targets: ['host'],
  requires: ['fs', 'fsObservationPolicy', 'tools'],
  optional: ['attachments', 'model', 'sandboxPolicy', 'approval', 'promptSections'], provides: [],
  resolve(input) {
    const caps = resolveConfig(input)
    return (context) => {
      const fs = context.require('fs')
      context.require('fsObservationPolicy')
      const tools = context.require('tools')
      if (fs.sandboxMode !== undefined && context.optional('sandboxPolicy') === undefined) {
        throw new Error('tool-fs: the mounted filesystem confines but sandboxPolicy is missing')
      }
      const attachments = context.optional('attachments')
      for (const contribution of [readTool(context, fs, caps),
        ...(attachments === undefined ? [] : [readImageTool(context, fs, attachments)]),
        writeTool(context, fs), editTool(context, fs)]) {
        context.effect(tools.registerValueTool(contribution, context.scope))
      }
      const sections = context.optional('promptSections')
      if (sections !== undefined) {
        const visible = (scope: NativeScope, name: string): boolean =>
          tools.schemas(scope).some(schema => schema.name === name)
        for (const section of [
          { name: 'tool:read', order: 1100, text: (scope: NativeScope) => visible(scope, 'read') ? READ_GUIDANCE : '' },
          { name: 'tool:write', order: 1200, text: (scope: NativeScope) => visible(scope, 'write') ? writeGuidance(visible(scope, 'edit')) : '' },
          { name: 'tool:edit', order: 1300, text: (scope: NativeScope) => visible(scope, 'edit') ? EDIT_GUIDANCE : '' },
        ]) context.effect(sections.register(section, context.scope))
      }
    }
  },
}
