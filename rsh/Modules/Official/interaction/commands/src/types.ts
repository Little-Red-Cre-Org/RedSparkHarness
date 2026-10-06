/** Compatibility command vocabulary and Cordis registry notifications. */
export type * from './facts.ts'

import type { EncodedImageAttachment } from '@deepseek-ai/dsh-attachment/types'

/** One browser-submitted command attachment: encoded image input or a staged file receipt. */
export type CommandSubmitAttachment =
  | ({ readonly type: 'image' } & EncodedImageAttachment)
  | { readonly type: 'file'; readonly receiptId: string }

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A command was registered or unregistered. This is an unfiltered registry
     * notification because a global or scoped change may affect any UI view.
     * Observer failures are contained and cannot veto the registry mutation.
     * @mode emit
     */
    'commands/change'(): void
  }
}
