/** One retained Markdown renderer over the document owner's accumulated text. */
import type { ReactNode } from 'react'
import type { PropsLocale } from '@redspark/rsh-client-ui-slots'
import { WorkspaceMarkdownPreview } from '@redspark/rsh-client-ui-primitives'
import type { DocumentPreviewProps } from '../document/contract.ts'
import type {} from './locales.ts'

/** Standard document inputs and this implementation's locale. */
export type MarkdownBodyProps = DocumentPreviewProps & PropsLocale<'documentMarkdown'>

/**
 * Render one accumulated document; EOF completes the primitive's full parse.
 * @param props - owner-loaded contents and localized primitive labels.
 * @returns Markdown content, or nothing for a non-text delivery.
 */
export function MarkdownBody({ content, t }: MarkdownBodyProps): ReactNode {
  if (content.kind !== 'text') return null
  return <WorkspaceMarkdownPreview text={content.text} eof={content.eof} labels={{
    code: { copyLabel: t('code.copy'), copiedLabel: t('code.copied') }, footnotes: t('footnotes'),
  }} />
}
