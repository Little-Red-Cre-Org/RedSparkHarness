/**
 * Composer attachment classification for the Native Client.
 *
 * The composer hands every dropped, pasted or picked file to this module so the
 * image rail and the general file rail stay independent: an image keeps the
 * Provider's raster rules, and anything else becomes a staged file.
 *
 * These limits are a usability guard, never a security boundary. The Host
 * admits what it admits, so every rejection here has a matching failure path
 * when the Host refuses the upload anyway.
 */
import type { NativeModelControls } from '@redspark/rsh-client-native-session/native'

/** Provider raster rules carried by the model controls. */
export type ImageLimits = NonNullable<NativeModelControls['images']>

/** Why one selected file never reached a rail. */
export type AttachmentRejection =
  | 'rejectedEmpty'
  | 'rejectedDuplicate'
  | 'rejectedFileSize'
  | 'rejectedFileCount'

/** How one delivered file batch splits across the two rails. */
export interface AttachmentBatch {
  /** Raster files admitted by the Provider's image rules. */
  readonly images: readonly File[]
  /** Everything else, admitted by the general file rules. */
  readonly files: readonly File[]
  /** Rejections worth telling the operator about, in first-seen order. */
  readonly rejected: readonly AttachmentRejection[]
}

/**
 * General file limits.
 *
 * The Host exposes `workspaceFiles.maxFileBytes` for *reading* a stored file
 * (default 32 MiB, alongside `maxLines`/`maxEntries` for paged reads); the
 * upload path itself applies no size cap, and no wire field publishes one. The
 * constants below therefore mirror that read default so a file the composer
 * accepts is at least one the file browser can show, and they are documented as
 * a front-end default rather than a Host contract.
 *
 * NOTE: the Host applies no upload cap (`stageStream` takes route, id, data and
 * name only, and `saveFileStreamVerbatim` writes whatever arrives), so this
 * client-side limit is the only one. Treat it as a guard against accidental
 * large uploads, not as a security boundary: a client that skips this check
 * can stage a file of any size, and the Host will store it.
 */
export const DEFAULT_MAX_FILE_BYTES = 32 * 1024 * 1024

/** Largest number of general files one message may stage. */
export const DEFAULT_MAX_FILES_PER_MESSAGE = 10

/** A stable identity for one selected file, used to drop repeats. */
function fileKey(file: File): string {
  return `${file.name}\u0000${String(file.size)}\u0000${String(file.lastModified)}\u0000${file.type}`
}

/**
 * Decide which rail one file belongs to.
 * @param file - the delivered file.
 * @param limits - Provider raster rules, or undefined when the Host offers no images.
 * @returns `image` for an admitted raster type, otherwise `file`.
 */
export function railForFile(file: File, limits: ImageLimits | undefined): 'image' | 'file' {
  return limits !== undefined && (limits.mediaTypes as readonly string[]).includes(file.type) ? 'image' : 'file'
}

/**
 * Split one delivered batch across the two rails.
 *
 * Repeats are dropped against the files already held as well as within the
 * batch, so dropping the same file twice stages it once. A file already staged
 * as an image is not re-checked against the file rules, and vice versa.
 * @param incoming - files delivered by a drop, paste or picker.
 * @param held - files the composer already holds on either rail.
 * @param limits - Provider raster rules, or undefined when the Host offers no images.
 * @param options - per-rail ceilings; omitted values use the module defaults.
 * @returns the admitted files per rail and the rejections worth reporting.
 */
export function classifyAttachments(
  incoming: readonly File[],
  held: { readonly images: readonly File[]; readonly files: readonly File[] },
  limits: ImageLimits | undefined,
  options: {
    readonly maxFileBytes?: number | undefined
    readonly maxFilesPerMessage?: number | undefined
  } = {},
): AttachmentBatch {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  const maxFilesPerMessage = options.maxFilesPerMessage ?? DEFAULT_MAX_FILES_PER_MESSAGE
  const seen = new Set<string>([
    ...held.images.map(fileKey),
    ...held.files.map(fileKey),
  ])
  const images: File[] = []
  const files: File[] = []
  const rejected: AttachmentRejection[] = []
  const note = (reason: AttachmentRejection): void => {
    if (!rejected.includes(reason)) rejected.push(reason)
  }
  let heldFileCount = held.files.length
  for (const file of incoming) {
    const key = fileKey(file)
    if (seen.has(key)) {
      note('rejectedDuplicate')
      continue
    }
    if (file.size === 0) {
      // A zero-byte drop is almost always an aborted or synthetic drop, and the
      // Host would store an unusable attachment for it.
      note('rejectedEmpty')
      continue
    }
    if (railForFile(file, limits) === 'image') {
      // The image rail applies the Provider's own byte, count and media rules;
      // duplicating them here would let the two disagree.
      images.push(file)
      seen.add(key)
      continue
    }
    if (file.size > maxFileBytes) {
      note('rejectedFileSize')
      continue
    }
    if (heldFileCount >= maxFilesPerMessage) {
      note('rejectedFileCount')
      continue
    }
    files.push(file)
    seen.add(key)
    heldFileCount += 1
  }
  return { images, files, rejected }
}

/**
 * Read whether a staged upload may still be sent.
 * @param entry - one staged file draft.
 * @returns true while the receipt is present and no failure is recorded.
 */
export function stagedFileReady(entry: StagedFileDraft): boolean {
  return entry.receiptId !== undefined && entry.error === undefined && entry.uploading !== true
}

/** One general-file draft held by the composer. */
export interface StagedFileDraft {
  /** The browser file the operator selected. */
  readonly file: File
  /** Host-issued receipt once the upload settles; the message consumes it. */
  readonly receiptId?: string | undefined
  /** True while this file's upload is in flight. */
  readonly uploading?: boolean | undefined
  /** Localized failure key when the Host refused the upload. */
  readonly error?: string | undefined
}

/**
 * Apply one upload outcome to the drafts.
 *
 * A failed upload keeps its draft so the operator can retry; dropping the draft
 * would silently discard the operator's selection and force them to pick the
 * file again.
 * @param drafts - current drafts in operator order.
 * @param file - the draft's file identity.
 * @param outcome - settled upload result.
 * @returns drafts with that one entry updated.
 */
export function settleUpload(
  drafts: readonly StagedFileDraft[],
  file: File,
  outcome: { readonly receiptId: string } | { readonly error: string },
): readonly StagedFileDraft[] {
  return drafts.map((draft) => {
    if (draft.file !== file) return draft
    if ('receiptId' in outcome) return { file: draft.file, receiptId: outcome.receiptId }
    // Keep the draft on failure: retry must not require re-selecting the file.
    return { file: draft.file, error: outcome.error }
  })
}

/**
 * Drop staged drafts whose local file is no longer held.
 * @param drafts - current drafts.
 * @param held - files the operator still has on the file rail.
 * @returns drafts limited to held files, preserving order.
 */
export function pruneStagedFiles(
  drafts: readonly StagedFileDraft[],
  held: readonly File[],
): readonly StagedFileDraft[] {
  const kept = new Set(held)
  return drafts.filter(draft => kept.has(draft.file))
}
