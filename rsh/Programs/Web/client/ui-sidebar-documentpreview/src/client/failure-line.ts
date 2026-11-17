/**
 * The failure line one Remote code deserves.
 *
 * Kept apart from the component so the mapping is testable on its own. Codes
 * this reader does not name fall to the generic line carrying the carrier's
 * message.
 */
import type { TranslateNS } from '@redspark/rsh-client-locale/client'

/** Failure fields a preview line can read. Resource frames carry these; Remote failures do too. */
interface FailureLineInput {
  readonly code: string
  readonly message: string
  readonly details?: unknown
}

/** Render a byte count the way a person reads one. */
function humanBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/** Read a finite byte cap. Any other payload falls through to the generic line. */
function byteLimit(details: unknown): number | undefined {
  if (typeof details !== 'object' || details === null || !('limit' in details)) return undefined
  const limit = details.limit
  return typeof limit === 'number' && Number.isFinite(limit) ? limit : undefined
}

/**
 * Say what went wrong, in terms of the file rather than of the transport.
 * @param t - namespace-bound translate.
 * @param failure - the settled failure. A size cap is read from `details.limit` when that field is a finite number.
 * @returns the line to show in place of the file.
 */
export function failureLine(t: TranslateNS<'sidebarDocumentPreview'>, failure: FailureLineInput): string {
  switch (failure.code) {
    case 'workspace-file/not-found': return t('error.notFound')
    case 'workspace-file/too-large': {
      const limit = byteLimit(failure.details)
      return limit === undefined
        ? t('error.unavailable', { message: failure.message })
        : t('error.tooLarge', { limit: humanBytes(limit) })
    }
    case 'workspace-file/not-text': return t('error.notText')
    case 'workspace-file/not-regular-file': return t('error.notRegularFile')
    // Carrier and unclassified host failures reach the reader as themselves:
    // this panel knows nothing useful to add to a transport-level message.
    default: return t('error.unavailable', { message: failure.message })
  }
}
