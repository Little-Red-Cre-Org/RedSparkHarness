import type { ToolCallOwnerProps, ToolImagesOwnerProps } from '../../tool-renderer-types.ts'
export type { ToolCallOwnerProps, ToolImagesOwnerProps } from '../../tool-renderer-types.ts'
/** Tool UI slot declarations and their composed component props. */
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Keyed atomic Tool call view, dispatched by the wire Tool name. Register
     * with `key: '<tool name>'` to own how one tool's calls render inside a
     * turn — the key domain is open (any wire tool name, including a tool your
     * own package registered), so there is no compile-time key set to pick
     * from and a typo simply never renders.
     *
     * A key the shipped composition already covers is replaced, not shared;
     * an unclaimed key falls back to the generic tool row, so registering is
     * additive for your own tool and a takeover for a shipped one. The owner
     * passes the call's identity, its frozen running-or-settled node, and the
     * expansion state (see ToolCallOwnerProps), so the view stays a pure
     * function of what the turn already knows.
     */
    'tool.call.toolview': { kind: 'keyed'; scope: 'session'; owner: ToolCallOwnerProps }
    /**
     * Durable images of a settled image-bearing Tool call, rendered through
     * the attachment presentation plugin. The Tool layer never imports an
     * attachment implementation: a toolview declares this slot as a child and
     * renders it with the image card's references plus the session-authorized
     * loader it received in its owner, and the attachment plugin fills the
     * gallery. Composing no attachment presentation plugin renders nothing,
     * which is why the image card keeps its own envelope text beside the
     * gallery. A child slot is declared by exactly one entry: registering a
     * second toolview that declares the same child throws at load, so a
     * future image-bearing tool must reuse this entry or own a distinct
     * slot.
     */
    'tool.call.images': { kind: 'single'; scope: 'session'; owner: ToolImagesOwnerProps }
  }
}

/** Full props of a registered atomic Tool view. */
export type ToolCallViewProps = PropsRuntime<'tool.call.toolview'>

/** Injected Host description for POSIX home-path display. */
export type ToolHostInfoInjected = {
  hooks: {
    /**
     * Fixed Host facts, reached through a hook rather than injected as values:
     * the renderer memoizes an entry's inject result for the registration's
     * lifetime, so facts read there would freeze at whatever the first render
     * saw. Select the field the view needs (`info => info.home`).
     */
    hostInfo: HostObservable<RemoteHostFacts>
  }
}

/** Full props of the Tool call-tree renderer registered as a `tool-call` Chat Node. */
export type ToolTreeProps = PropsRuntime<'conversation.chat.node', 'tool-call'>
  & PropsRenderSlots<'tool.call.toolview'>
  & PropsLocale<'conversation'>
  & InjectFace<ToolHostInfoInjected>
