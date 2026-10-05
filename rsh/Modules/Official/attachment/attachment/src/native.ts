/** Native attachment service Definition without a Cordis service or runtime import. */
import type {} from '@deepseek-ai/dsh-native-runtime'
import type { AttachmentOperations } from './types.ts'

export type { AttachmentOperations } from './types.ts'
export { isImageAdmissionError, type ImageAdmissionErrorCode } from './error.ts'
export type {
  AdmittedPromptContentPart, AttachmentAdmissionPart, EncodedFileAttachment,
  FileAttachmentRef, ImageAttachmentLimits, ImageAttachmentRef, ImageRequestPolicy,
  RequestImageAttachment, SaveFileAttachment, SaveFileStreamAttachment, SaveImageAttachment,
  StoredImageAttachment,
} from './types.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { attachments: AttachmentOperations }
}
