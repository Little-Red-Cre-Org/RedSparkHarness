/** Browser title selection follows the active main panel without subscribing the frame. */
import { useEffect } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { PanelInfo } from './service.ts'

/** Session list facts needed by the compatibility title projection. */
export interface SessionTitleSource {
  current: string | undefined
  byId: Record<string, { title?: string | undefined }>
}

/** Props for the browser title projection. */
export type DocumentTitleProps = {
  /** Build-configured or localized product title. */
  productTitle: string
  usePanelInfo: SnapshotSelectorHook<PanelInfo>
} & ({ useCurrentSessionTitle: SnapshotSelectorHook<string | undefined>; useSessions?: never }
  | { useSessions: SnapshotSelectorHook<SessionTitleSource>; useCurrentSessionTitle?: never })

/**
 * Project the selected durable session title into the browser title and
 * restore the build-selected product title when unmounted.
 * @param props - Selected session title projection.
 * @returns No rendered content.
 */
export function DocumentTitle(props: DocumentTitleProps) {
  if (props.useSessions !== undefined) {
    return <ClientDocumentTitle productTitle={props.productTitle} useSessions={props.useSessions}
      usePanelInfo={props.usePanelInfo} />
  }
  return <NativeDocumentTitle productTitle={props.productTitle} useCurrentSessionTitle={props.useCurrentSessionTitle}
    usePanelInfo={props.usePanelInfo} />
}

function NativeDocumentTitle(
  { useCurrentSessionTitle, usePanelInfo, productTitle }: Extract<DocumentTitleProps, { useCurrentSessionTitle: unknown }>,
) {
  const showSessionTitle = usePanelInfo(info => info.activePanelId === null)
  const title = useCurrentSessionTitle(value => value)
  return <Title title={showSessionTitle ? title : undefined} productTitle={productTitle} />
}

function ClientDocumentTitle(
  { useSessions, usePanelInfo, productTitle }: Extract<DocumentTitleProps, { useSessions: unknown }>,
) {
  const showSessionTitle = usePanelInfo(info => info.activePanelId === null)
  const title = useSessions((state) => {
    const current = state.current
    return !showSessionTitle || current === undefined ? undefined : state.byId[current]?.title
  })
  return <Title title={title} productTitle={productTitle} />
}

function Title({ title, productTitle }: { title: string | undefined; productTitle: string }) {
  useEffect(() => {
    document.title = title === undefined ? productTitle : `${title} — ${productTitle}`
    return () => { document.title = productTitle }
  }, [productTitle, title])
  return null
}
