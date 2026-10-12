/** Complete HTML rendered in a script-enabled opaque iframe, without parent application access. */
import { useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { WorkspaceHtmlPreview } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DocumentPreviewProps } from '../document/contract.ts'
import { createReadHtmlRelative } from './read-relative.ts'
import type { ReadHtmlRelated } from './read-relative.ts'
import type {} from './locales.ts'

/** Standard document inputs plus this renderer's dictionary. */
export type HtmlBodyProps = DocumentPreviewProps & PropsLocale<'documentHtml'> & {
  /** Ordinary Remote callback bound by this renderer's Slot inject. */
  readonly readRelated: ReadHtmlRelated
}

/**
 * Render complete HTML with the standard file and tab hooks.
 * @param props - document bytes, hooks, related-file reader and locale.
 * @returns an isolated HTML document, or nothing for text delivery.
 */
export function HtmlBody({ content, resourceAddress, readRelated, useTabInfo, t }: HtmlBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const readRelative = useMemo(
    () => createReadHtmlRelative(readRelated, resourceAddress, tab.signal),
    [readRelated, resourceAddress, tab.signal],
  )
  const readBytes = useCallback(async (reference: string, signal: AbortSignal) =>
    (await readRelative(reference, signal)).data, [readRelative])
  if (content.kind !== 'bytes') return null
  return <WorkspaceHtmlPreview key={resourceAddress} data={content.data} readRelative={readBytes}
    labels={{ loading: t('loading'), failed: t('failed'), frame: t('frame') }} />
}
