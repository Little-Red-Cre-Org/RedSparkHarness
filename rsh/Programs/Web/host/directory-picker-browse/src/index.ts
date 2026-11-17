/**
 * Browse backend of the directory-picker seam: registers `ctx.directoryPicker`
 * with the `browse` capability — one-level directory listing and child-directory
 * creation over the host filesystem via Node's stdlib (which already carries
 * the per-OS adaptation). Nothing renders on the host display, so this backend
 * serves remote clients the dialog backend cannot. Policy decisions (hidden
 * entries flagged but returned, symlinks followed, whole-filesystem scope) are
 * recorded in the directory-picker seam Agent Note.
 * @module @redspark/rsh-host-directory-picker-browse
 */

import type { Context } from '@redspark/cordis'
import z from '@redspark/schemastery'
import { DirectoryPicker } from '@redspark/rsh-host-directory-picker'
import type { DirectoryListing, DirectoryPickerCapability } from '@redspark/rsh-host-directory-picker'
import { createChildDirectory, listDirectory } from './browse.ts'

export { boundedInsert, fullyQualified, raceAbort } from './browse.ts'
export type { ListingCandidate } from './browse.ts'

/** Validated plugin configuration. */
export interface Config {
  /** Complete-result bound of one listing level; see {@link BrowseDirectoryPicker.Config}. */
  maxEntries: number
}

/** The `ctx.directoryPicker` browse implementation (stable capability object per service life). */
export default class BrowseDirectoryPicker extends DirectoryPicker {
  /**
   * `maxEntries` bounds the complete listing level a single `list` call may
   * materialize and put on the wire: at most this many child-directory rows
   * (hidden rows included), with `truncated` flagging a cut level. The
   * default follows GitHub's web UI, which truncates directory listings at
   * 1,000 entries.
   */
  static Config: z<Config> = z.object({
    maxEntries: z.natural().min(1).default(1000),
  })

  private readonly browseCapability: DirectoryPickerCapability = {
    kind: 'browse',
    list: (path, signal) => this.list(path, signal),
    createDirectory: (path, name) => this.createDirectory(path, name),
  }

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
  }

  /**
   * The browse interaction capability.
   * @returns the stable `browse` capability object.
   */
  capability(): DirectoryPickerCapability {
    return this.browseCapability
  }

  private list(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    return listDirectory(path, signal, this.config.maxEntries)
  }

  private createDirectory(path: string, name: string): Promise<string> {
    return createChildDirectory(path, name)
  }
}
