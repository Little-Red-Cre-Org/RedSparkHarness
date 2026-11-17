/**
 * One sentence per endpoint code, and the transport's own words for anything else.
 */
import { describe, expect, it } from 'vitest'
import type { RemoteFailure } from '@redspark/rsh-api-remotes/client'
import type { TranslateNS } from '@redspark/rsh-client-ui-slots'
// The namespace declaration `TranslateNS<'sidebarDocumentPreview'>` resolves against.
import type {} from '../src/client/index.ts'
import { failureLine } from '../src/client/failure-line.ts'

/** Key-echoing translate that also shows its parameters, so a formatted value is visible. */
const t: TranslateNS<'sidebarDocumentPreview'> = (key, params) =>
  params === undefined ? key : `${key}(${Object.entries(params).map(([k, v]) => `${k}=${String(v)}`).join(',')})`

function failure(code: string, details: Record<string, unknown> = {}, message = 'boom'): RemoteFailure {
  return { code, message, details } as unknown as RemoteFailure
}

describe('failureLine', () => {
  it('names each workspace-file code', () => {
    expect(failureLine(t, failure('workspace-file/not-found'))).toBe('error.notFound')
    expect(failureLine(t, failure('workspace-file/not-text'))).toBe('error.notText')
    expect(failureLine(t, failure('workspace-file/not-regular-file'))).toBe('error.notRegularFile')
  })

  it('states the byte cap the way a person reads one', () => {
    expect(failureLine(t, failure('workspace-file/too-large', { limit: 512 }))).toBe('error.tooLarge(limit=512 B)')
    expect(failureLine(t, failure('workspace-file/too-large', { limit: 4096 }))).toBe('error.tooLarge(limit=4 KB)')
    expect(failureLine(t, failure('workspace-file/too-large', { limit: 3 * 1024 * 1024 }))).toBe('error.tooLarge(limit=3 MB)')
  })

  it('passes any other failure through in its own words', () => {
    expect(failureLine(t, failure('gateway/internal', {}, 'socket closed'))).toBe('error.unavailable(message=socket closed)')
  })

  it('uses the generic line when a size cap is missing or not a finite number', () => {
    expect(failureLine(t, { code: 'workspace-file/too-large', message: 'no cap' })).toBe('error.unavailable(message=no cap)')
    expect(failureLine(t, { code: 'workspace-file/too-large', message: 'null cap', details: null })).toBe('error.unavailable(message=null cap)')
    expect(failureLine(t, failure('workspace-file/too-large', {}, 'empty cap'))).toBe('error.unavailable(message=empty cap)')
    expect(failureLine(t, failure('workspace-file/too-large', { limit: '512' }, 'text cap'))).toBe('error.unavailable(message=text cap)')
    expect(failureLine(t, failure('workspace-file/too-large', { limit: Number.POSITIVE_INFINITY }, 'infinite cap'))).toBe('error.unavailable(message=infinite cap)')
  })
})
