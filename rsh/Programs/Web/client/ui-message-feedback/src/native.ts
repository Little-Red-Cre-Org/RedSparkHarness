/**
 * Native entry for the message-feedback surface.
 *
 * The browser build contributes into two browser-only slots
 * (`conversation.chat.assistant-actions` and `conversation.input.overlay`),
 * neither of which the Native shell declares. It therefore contributes into the
 * Native equivalents instead: `native.conversation.message.actions`, declared by
 * `ui-session` and rendered by the Native transcript's assistant action row, and
 * `shell.overlay`, declared by `ui-layout` and rendered over the app frame.
 *
 * Everything below the slot layer is the browser build's own code, unchanged:
 * the two entry components and both controllers are imported as-is. The one
 * difference is where the Host calls come from — `clientNativeSession`'s
 * message-feedback methods instead of the browser's `ctx.remote` namespaces —
 * and that difference is carried by a transport, so the compare-and-set logic
 * keeps living in exactly one place.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/native'
import type {} from '@deepseek-ai/dsh-client-ui-session/native'
import type {} from '@deepseek-ai/dsh-client-ui-layout/native'
import type {} from '@deepseek-ai/dsh-client-locale/native'
import type { NativeSessionClient } from '@deepseek-ai/dsh-client-native-session/native'
import type { FeedbackDialogInjected, MessageFeedbackInjected } from './client/slots.ts'
import type { FeedbackDialogState } from './client/dialog.ts'
import type { MessageFeedbackCarried } from './client/controller.ts'
import type { FeedbackSurfaceTransport, SessionFeedbackCall } from './client/surface.ts'
import { FeedbackDialog } from './client/FeedbackDialog.tsx'
import { MessageFeedbackActions } from './client/MessageFeedbackActions.tsx'
import { FeedbackSurface } from './client/surface.ts'
import { en, zh } from './client/locales.ts'

export type {
  MessageFeedbackActionFailure, MessageFeedbackActionResult, MessageFeedbackStatus,
  MessageFeedbackView,
} from './client/controller.ts'
export type { FeedbackDialogState, FeedbackDialogTarget, FeedbackSubmit } from './client/dialog.ts'
export type {
  FeedbackDialogInjected, FeedbackDialogProps, MessageFeedbackActionProps, MessageFeedbackInjected,
} from './client/slots.ts'
export type { MessageFeedbackKey } from './client/locales.ts'

/** Dictionary namespace owned by this plugin, shared with the browser build. */
const NS = 'feedback'

/**
 * The Native Session client methods this plugin drives.
 *
 * The four message-feedback operations are the Native transport's business
 * calls; `messageFeedbackPut` is the one a recorded judgment goes through.
 */
type NativeFeedbackClient = Pick<NativeSessionClient,
  'messageFeedbackList' | 'messageFeedbackPut' | 'messageFeedbackDelete' | 'sessionFeedbackRecord'>

/**
 * Bind the Native client's feedback methods as a surface transport.
 *
 * `clientNativeSession` answers with the business result directly, while the
 * surface expects the browser's two-level carrier shape. A direct call that
 * resolved is a carrier success, and a rejected promise is a carrier failure —
 * the same split `ctx.remote` reports.
 * @param client - the Native Session client selected by the browser composition.
 * @returns the transport the surface drives.
 */
export function nativeTransport(client: NativeFeedbackClient): FeedbackSurfaceTransport {
  const carried = async <T>(call: () => Promise<T>): Promise<MessageFeedbackCarried<T>> => {
    try {
      return { ok: true, value: await call() }
    } catch (error: unknown) {
      return {
        ok: false,
        error: {
          code: 'native/transport',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }
  const recordSession: SessionFeedbackCall = request => carried(async () => client.sessionFeedbackRecord(request))
  return {
    list: request => carried(async () => client.messageFeedbackList(request)),
    put: request => carried(async () => client.messageFeedbackPut(request)),
    delete: request => carried(async () => client.messageFeedbackDelete(request)),
    recordSession,
  }
}

/** Native message feedback: per-message rating controls and the Session's dialog. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-client-ui-message-feedback',
  targets: ['client'],
  requires: ['clientSlots', 'clientLocale', 'clientNativeSession'],
  optional: [],
  provides: [],
  resolve(input) {
    if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length > 0)) throw new TypeError('native message feedback: invalid configuration')
    return (context) => {
      const slots = context.require('clientSlots')
      const locale = context.require('clientLocale')
      const client = context.require('clientNativeSession')
      context.own(locale.register(NS, { en, zh }))

      const transport = nativeTransport(client)
      const surfaces = new Map<SessionId, FeedbackSurface>()
      const surfaceFor = (sessionId: SessionId): FeedbackSurface => {
        let surface = surfaces.get(sessionId)
        if (surface === undefined) {
          surface = new FeedbackSurface(transport, sessionId)
          surfaces.set(sessionId, surface)
        }
        return surface
      }
      context.own(() => {
        for (const surface of surfaces.values()) surface.dispose()
        surfaces.clear()
      })

      context.own(slots.inject('native.conversation.message.actions', () => slots.register({
        name: 'native.conversation.message.actions',
        id: 'feedback',
        order: 10,
        locale: NS,
        // A session-scoped list entry is injected with the Session the transcript
        // is rendering; the addressed message arrives as the owner's `messageId`.
        inject: (sessionId: SessionId): MessageFeedbackInjected => {
          const { feedback, dialog } = surfaceFor(sessionId)
          return {
            hooks: { feedback },
            ensure: () => feedback.ensure(),
            current: messageId => feedback.getSnapshot().items.get(messageId),
            retract: (messageId, rating) => feedback.retract(messageId, rating),
            openDialog: (messageId, rating) => { dialog.open({ kind: 'message', messageId, rating }) },
          }
        },
      }, MessageFeedbackActions)))

      // One dialog per Session, over the whole Native shell. The browser build
      // parks it in `conversation.input.overlay`; the Native shell's equivalent
      // root-level overlay surface is `shell.overlay` (declared by ui-layout).
      context.own(slots.inject('shell.overlay', () => slots.register({
        name: 'shell.overlay',
        id: 'feedback-dialog',
        order: 2,
        locale: NS,
        inject: (): FeedbackDialogInjected => {
          const snapshot = context.require('clientNativeConversation').getSnapshot()
          const sessionId = snapshot.selected
          // No Session is open, so no remark can be addressed: the dialog
          // renders nothing until a Session is selected.
          if (sessionId === undefined) {
            return {
              hooks: { dialog: IDLE_DIALOG },
              edit: () => {},
              submit: () => Promise.resolve(),
              dismiss: () => {},
              dismissFailure: () => {},
              dismissToast: () => {},
            }
          }
          const { dialog } = surfaceFor(sessionId)
          return {
            hooks: { dialog: dialog.state },
            edit: (draft) => { dialog.edit(draft) },
            submit: () => dialog.submitDraft(),
            dismiss: () => { dialog.dismiss() },
            dismissFailure: () => { dialog.dismissFailure() },
            dismissToast: (seq) => { dialog.dismissToast(seq) },
          }
        },
      }, FeedbackDialog)))
    }
  },
}

/** Closed dialog state used while no Session is selected. */
const IDLE_DIALOG: HostObservable<FeedbackDialogState> = {
  getSnapshot: () => CLOSED_STATE,
  subscribe: () => () => {},
}

const CLOSED_STATE: FeedbackDialogState = Object.freeze({
  target: null, category: null, text: '', submitting: false, failure: null, toast: 0,
})
