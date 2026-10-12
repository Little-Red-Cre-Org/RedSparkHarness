/** Complete image bytes rendered at their intrinsic CSS-pixel dimensions. */
import { useMemo, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { WorkspaceImagePreview } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DocumentPreviewProps } from '../document/contract.ts'
import { hostFileOf } from '../rpc.ts'
import type {} from './locales.ts'
export { workspaceImageMediaType as imageMediaType } from '@deepseek-ai/dsh-client-ui-primitives'

/** Standard document props plus the image renderer's dictionary. */
export type ImageBodyProps = DocumentPreviewProps & PropsLocale<'sidebarImage'>

/** Present the file bytes using the shared Cordis-free image renderer. */
export function ImageBody({ content, resourceAddress, t }: ImageBodyProps): ReactNode {
  const path = useMemo(() => hostFileOf(resourceAddress).path, [resourceAddress])
  return <WorkspaceImagePreview path={path} data={content.kind === 'bytes' ? content.data : undefined}
    labels={{ loading: t('loading'), failed: t('failed'), unsupported: t('unsupported'), preview: name => t('preview', { name }) }} />
}
