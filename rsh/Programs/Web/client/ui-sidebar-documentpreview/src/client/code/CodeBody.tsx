/** Incrementally highlighted source; the document owner supplies the accumulated text and wrap preference. */
import type { ReactNode } from 'react'
import type { PropsLocale } from '@redspark/rsh-client-ui-slots'
import { parseFileAddress } from '@redspark/rsh-util-workspace-path'
import { WorkspaceCodePreview } from '@redspark/rsh-client-ui-primitives'
import type { DocumentPreviewProps } from '../document/contract.ts'
import type {} from './locales.ts'

/** Document owner props and this renderer's localized controls. */
export type CodeBodyProps = DocumentPreviewProps & PropsLocale<'sidebarCodePreview'>

/** @param props - accumulated document contents and framework props. @returns one stable CodeBlock, or no body for byte contents. */
export function CodeBody({ resourceAddress, content, wrap, scrollportRef, t }: CodeBodyProps): ReactNode {
  if (content.kind !== 'text') return null
  const file = parseFileAddress(resourceAddress)
  if (file === undefined) throw new Error(`ui-sidebar-documentpreview: not a file address "${resourceAddress}"`)
  return <WorkspaceCodePreview path={file.path} text={content.text} eof={content.eof} wrap={wrap}
    copyLabel={t('copy')} copiedLabel={t('copied')} contentRef={scrollportRef} />
}
