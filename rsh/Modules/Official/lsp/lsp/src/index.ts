/**
 * Service Definition for the LSP capability seam (`ctx.lsp`): a language-server provider registry and per-query,
 * order-independent selection over normalized goToDefinition/findReferences/goToImplementation/
 * hover queries.
 *
 * A provider reserves a branded id and an exclusive set of file extensions atomically:
 * {@link Lsp.registerProvider} validates and conflict-checks everything before mutating, so an
 * invalid or conflicting registration publishes nothing, and its disposer releases every
 * reservation together. Selection routes a query by the file's final extension; it never depends on
 * registration order. The seam exposes exactly the four operations and no JSON-RPC escape hatch.
 * @module @redspark/rsh-lsp
 */

import { Context, Service } from '@redspark/cordis'
import type {
  LspProvider,
  LspQueryRequest,
  LspQueryResult,
  LspService,
} from './types.ts'
import { LspRegistry, type LspReservation } from './registry.ts'

export { LspProviderId } from './brand.ts'
export { finalExtension, LspError } from './registry.ts'
export type {
  LspHover,
  LspLocation,
  LspOperation,
  LspPosition,
  LspProvider,
  LspProviderQuery,
  LspQueryRequest,
  LspQueryResult,
  LspRange,
  LspService,
} from './types.ts'

declare module '@redspark/cordis' {
  interface Context {
    lsp: LspService
  }
}

/**
 * `ctx.lsp`. The registry lives in {@link LspRegistry}; this service only ties each reservation to
 * the calling fiber so disposal releases the id and every extension together.
 */
export class Lsp extends Service implements LspService {
  private readonly registry = new LspRegistry()

  constructor(ctx: Context) {
    super(ctx, 'lsp')
  }

  registerProvider(provider: LspProvider): () => void {
    // Validate before the effect so an invalid or conflicting registration publishes nothing.
    const reservation: LspReservation = this.registry.prepare(provider)
    const dispose = this.ctx.effect(function* (this: Lsp) {
      this.registry.commit(reservation)
      yield () => { this.registry.release(reservation) }
    }.bind(this), 'lsp.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is synchronous
    // fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  query(request: LspQueryRequest, signal?: AbortSignal): Promise<LspQueryResult> {
    return this.registry.query(request, signal)
  }
}

export default Lsp
