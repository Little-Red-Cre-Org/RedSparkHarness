/** Props-only User message bubble shared by native and Cordis Chat views. */
import { Fragment } from 'react'
import type { ReactNode } from 'react'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/native'
import {
  fileExtension, FileTypeIcon, fileSizeText, JsonBlock, projectUserText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { UserTextReferences } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatMessageImage, ChatRenderMessageImages, ChatTranslator } from '../../native-contracts.ts'
import css from './MessageItem.module.css'

type ChatFileAttachment = Extract<ContentBlock, { readonly type: 'file' }>['attachment']

export type ChatPresentedAttachment =
  | { readonly type: 'image'; readonly image: ChatMessageImage }
  | { readonly type: 'file'; readonly file: ChatFileAttachment }

/** Render one Chat user message with optional pending and action presentation.
 * @param props - typed message content, image rendering, optional references and actions, and Chat locale.
 * @returns the shared User message bubble.
 */
export function UserMessageView({
  content, renderMessageImages, actions, pending = false, echo = false, referenceLabels = [], skillNames = [],
  previewAttachments, references, t,
}: {
  readonly content: readonly ContentBlock[]
  readonly renderMessageImages: ChatRenderMessageImages
  readonly actions?: (text: string) => ReactNode
  readonly pending?: boolean
  readonly echo?: boolean
  readonly referenceLabels?: readonly string[]
  readonly skillNames?: readonly string[]
  readonly previewAttachments?: readonly ChatPresentedAttachment[]
  readonly references?: UserTextReferences
  readonly t: ChatTranslator
}): ReactNode {
  const texts: string[] = []
  const attachments: ChatPresentedAttachment[] = []
  const rest: ContentBlock[] = []
  for (const block of content) {
    if (block.type === 'text') texts.push(block.text)
    else if (block.type === 'image') attachments.push({ type: 'image', image: { attachment: block.attachment } })
    else if (block.type === 'file') attachments.push({ type: 'file', file: block.attachment })
    else rest.push(block)
  }
  const text = texts.join('')
  const shownAttachments = previewAttachments ?? attachments
  const compactImages = shownAttachments.length > 1
  const truncated = (total: number): string => t('json.truncated', { total })
  const showBubble = text !== '' || rest.length > 0
  return (
    <div className={css.userRow} data-pending-steering={pending || undefined} data-submission-echo={echo || undefined}>
      <div className={css.userStack}>
        {shownAttachments.length > 0 && (
          <div className={css.attachmentRow} data-message-attachments>
            {shownAttachments.map((attachment, index) => attachment.type === 'image'
              ? <Fragment key={`image:${index}`}>
                {renderMessageImages({ images: [attachment.image], align: 'end', compact: compactImages })}
              </Fragment>
              : <span key={`file:${index}`} className={css.fileCard} title={attachment.file.name}>
                <FileTypeIcon path={attachment.file.name} className={css.fileIcon} />
                <span className={css.fileContent}>
                  <span className={css.fileName}>{attachment.file.name}</span>
                  <span className={css.fileMeta}>
                    {[fileExtension(attachment.file.name).toUpperCase().slice(0, 8), fileSizeText(attachment.file.bytes)]
                      .filter(Boolean).join(' ')}
                  </span>
                </span>
              </span>)}
          </div>
        )}
        {showBubble && <div className={css.bubble}>
          {projectUserText(text, referenceLabels, skillNames, 'skill', references)}
          {rest.map((block, index) => <JsonBlock key={index} label={t('message.extraBlock')} payload={block} truncatedLabel={truncated} />)}
        </div>}
        {referenceLabels.length > 0 && (
          <div className={css.referenceSummary}>
            {t('message.referenceSummary', { labels: referenceLabels.join(t('message.referenceSeparator')) })}
          </div>
        )}
      </div>
      {actions?.(text)}
    </div>
  )
}
