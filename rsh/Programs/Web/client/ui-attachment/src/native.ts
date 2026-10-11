/** Cordis-free attachment components for Native Client applications. */
import { AttachmentRail } from './AttachmentRail.tsx'
import type { AttachmentRailItem } from './AttachmentRail.tsx'
import { DropOverlay } from './DropOverlay.tsx'
import { FileCard } from './FileCard.tsx'
import { ImageLightbox } from './ImageLightbox.tsx'
import { MessageImage } from './MessageImage.tsx'

export { AttachmentRail, DropOverlay, FileCard, ImageLightbox, MessageImage }
export type { AttachmentRailItem, AttachmentRailLabels } from './AttachmentRail.tsx'
export type { DropOverlayLabels } from './DropOverlay.tsx'
export type { FileCardLabels, FileCardState } from './FileCard.tsx'
export type { ImageLightboxLabels } from './ImageLightbox.tsx'
export type { ImageLoader, MessageImageLabels, MessageImageSpec } from './MessageImage.tsx'

/** Props accepted by {@link AttachmentRail}. */
export type AttachmentRailProps<T extends AttachmentRailItem = AttachmentRailItem> =
  Parameters<typeof AttachmentRail<T>>[0]

/** Props accepted by {@link DropOverlay}. */
export type DropOverlayProps = Parameters<typeof DropOverlay>[0]

/** Props accepted by {@link FileCard}. */
export type FileCardProps = Parameters<typeof FileCard>[0]

/** Props accepted by {@link ImageLightbox}. */
export type ImageLightboxProps = Parameters<typeof ImageLightbox>[0]

/** Props accepted by {@link MessageImage}. */
export type MessageImageProps = Parameters<typeof MessageImage>[0]
