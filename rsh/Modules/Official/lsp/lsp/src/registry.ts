/**
 * Framework-free LSP provider registry. Cordis `ctx.lsp` and the native Provider
 * both commit through this table, so extension routing and conflict checks stay one implementation.
 * @module @redspark/rsh-lsp/registry
 */

import { HarnessError } from '@redspark/rsh-errors'
import type { LspProviderId } from './brand.ts'
import type {
  LspProvider,
  LspQueryRequest,
  LspQueryResult,
  LspService,
} from './types.ts'

/**
 * Structured LSP failure. Extends {@link HarnessError} with a stable `code`
 * (`LSP_INVALID_PROVIDER`, `LSP_CONFLICT`, `LSP_UNAVAILABLE`, `LSP_DISPOSED`,
 * `LSP_UNSUPPORTED_OPERATION`, `LSP_MALFORMED_RESPONSE`, and others) that callers route on instead of
 * parsing `message`.
 */
export class LspError extends HarnessError {}

/**
 * Extract a file's final extension as a normalized, lowercase, leading-dot key
 * (`Foo.TS` becomes `.ts`, `foo.d.ts` becomes `.ts`). Returns `''` for a name with no extension
 * or a leading-dot dotfile (`.bashrc`), which no route ever matches. Splits on both `/` and `\`
 * so a caller's path separator does not change the result.
 * @param filePath - the source path to inspect.
 * @returns the normalized extension, or `''` when there is none.
 */
export function finalExtension(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  const base = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath
  const dot = base.lastIndexOf('.')
  // dot <= 0 covers both "no dot" (-1) and a leading-dot dotfile (0): neither has an extension.
  if (dot <= 0) return ''
  return base.slice(dot).toLowerCase()
}

/** A well-formed normalized extension: a dot followed by one or more non-dot, non-separator chars. */
const EXTENSION_PATTERN = /^\.[^./\\]+$/

/** One selection route: the provider to run plus the language id to synchronize the document with. */
interface Route {
  readonly provider: LspProvider
  readonly languageId: string
}

/** A validated registration that has not been published yet. */
export interface LspReservation {
  readonly id: LspProviderId
  readonly pending: ReadonlyMap<string, Route>
}

/** Lowercase an extension and ensure it carries a leading dot; `EXTENSION_PATTERN` rejects the rest. */
function normalizeExtension(ext: string): string {
  const lower = ext.toLowerCase()
  return lower.startsWith('.') ? lower : `.${lower}`
}

/**
 * Id reservations and the extension→route table. A route is published only after every check passes,
 * and disposal releases the id together with every extension.
 */
export class LspRegistry implements LspService {
  private readonly providerIds = new Set<LspProviderId>()
  private readonly routes = new Map<string, Route>()
  private readonly reservations = new Set<LspReservation>()

  /**
   * Validate and conflict-check a provider without publishing it.
   * @param provider - the backend to register.
   * @returns the reservation to commit, or throws `LspError` when nothing may be published.
   */
  prepare(provider: LspProvider): LspReservation {
    const id = provider.id
    if (id.trim() === '') {
      throw new LspError('an LSP provider id must be a non-empty string', 'LSP_INVALID_PROVIDER')
    }
    if (this.providerIds.has(id)) {
      throw new LspError(`an LSP provider with id "${id}" is already registered`, 'LSP_CONFLICT')
    }

    const entries = Object.entries(provider.extensionToLanguage)
    if (entries.length === 0) {
      throw new LspError(`LSP provider "${id}" registers no file extensions`, 'LSP_INVALID_PROVIDER')
    }

    const pending = new Map<string, Route>()
    for (const [rawExt, languageId] of entries) {
      const ext = normalizeExtension(rawExt)
      if (!EXTENSION_PATTERN.test(ext)) {
        throw new LspError(`LSP provider "${id}" maps an invalid extension "${rawExt}"`, 'LSP_INVALID_PROVIDER')
      }
      if (languageId.trim() === '') {
        throw new LspError(`LSP provider "${id}" maps extension "${ext}" to an empty language id`, 'LSP_INVALID_PROVIDER')
      }
      if (pending.has(ext)) {
        throw new LspError(`LSP provider "${id}" maps extension "${ext}" more than once`, 'LSP_INVALID_PROVIDER')
      }
      pending.set(ext, { provider, languageId })
    }
    for (const ext of pending.keys()) {
      if (this.routes.has(ext)) {
        throw new LspError(`extension "${ext}" is already handled by another LSP provider`, 'LSP_CONFLICT')
      }
    }
    return { id, pending }
  }

  /** Publish a reservation prepared against this registry. */
  commit(reservation: LspReservation): void {
    this.providerIds.add(reservation.id)
    for (const [ext, route] of reservation.pending) this.routes.set(ext, route)
    this.reservations.add(reservation)
  }

  /** Drop a published reservation. Repeated calls are a no-op. */
  release(reservation: LspReservation): void {
    if (!this.reservations.delete(reservation)) return
    this.providerIds.delete(reservation.id)
    for (const ext of reservation.pending.keys()) this.routes.delete(ext)
  }

  /**
   * Register a provider immediately and return an idempotent disposer.
   * Cordis installs the same reservation inside the calling fiber's effect instead.
   * @param provider - the backend to register.
   * @returns a synchronous disposer releasing the id and all extension reservations.
   */
  registerProvider(provider: LspProvider): () => void {
    const reservation = this.prepare(provider)
    this.commit(reservation)
    return () => { this.release(reservation) }
  }

  async query(request: LspQueryRequest, signal?: AbortSignal): Promise<LspQueryResult> {
    const route = this.routes.get(finalExtension(request.filePath))
    if (route === undefined) {
      throw new LspError(`no LSP provider handles "${request.filePath}"`, 'LSP_UNAVAILABLE')
    }
    return route.provider.query({ ...request, languageId: route.languageId }, signal)
  }

  /** Drop every published reservation. In-flight queries keep the provider they already selected. */
  clear(): void {
    for (const reservation of [...this.reservations]) this.release(reservation)
  }
}
