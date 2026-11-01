/**
 * Native entry for the trigger pipeline: `/` and `@` detection, the candidate
 * menu, and pick routing to registered sources.
 *
 * The pipeline itself is NOT reimplemented here. `core/detect.ts` and
 * `core/menu.ts` are already Cordis-free, and `client/controller.ts` holds the
 * hit/fetch/highlight state whose only Cordis contact is a single `bail`
 * dispatch. This module supplies a Native equivalent of that one contact and
 * lets the same controller run, so the browser and Native builds cannot drift.
 *
 * Three things Cordis provided for free had to be rebuilt:
 *
 * * **Session scoping.** Cordis resolves a per-session `Context` and disposes it
 *   with the session fiber. Native has none, so a controller per Session id
 *   lives in the service and is released when the Session leaves the Host's
 *   list.
 * * **Roster prewarm.** The Cordis service warms a source roster at scope
 *   birth. Native has no such moment, so a controller created later replays
 *   `sourceAdded` for sources that already exist.
 * * **The input-mutation events.** `slash/input-*` are Cordis `bail` events;
 *   see `client/native-dispatch.ts` for the Native equivalent.
 */

import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/native'
import type {} from '@deepseek-ai/dsh-client-ui-session/native'
import type { InputDispatch } from './client/native-dispatch.ts'
import { InputTriggerController } from './client/controller.ts'
import type { MenuState, TriggerHit } from './core/contract.ts'
import type {
  InputTriggerCrumb, InputTriggerSource, PickAction, TriggerGuard,
} from './types.ts'

/**
 * The Session facts this package needs, declared structurally.
 *
 * This is a subset of `NativeConversationService`: the selected Session and the
 * stored Session list. Declaring it here instead of importing that interface
 * keeps the contract explicit about how little of the Session the pipeline
 * reads, and lets a test supply a two-line stand-in.
 */
export interface NativeSessionReadFace {
  /** Current controller snapshot. */
  getSnapshot(): {
    /** Selected durable Session, or undefined when none is open. */
    readonly selected?: SessionId | undefined
    /** Host-ordered durable Session index. */
    readonly sessions: readonly { readonly header: { readonly id: SessionId } }[]
  }
  /** Subscribe to controller-owned state changes. */
  subscribe(listener: () => void): () => void
}

/**
 * One Session's live trigger pipeline, in the shape a menu surface consumes.
 *
 * These are the same members the Cordis slot face injects into `MenuView`, so a
 * Native menu component can render the same props against either build.
 */
export interface NativeInputTriggerSession {
  /** Menu state store. */
  readonly menu: SnapshotStore<MenuState>
  /** Crumbs published per source for the open menu. */
  readonly headers: SnapshotStore<ReadonlyMap<string, readonly InputTriggerCrumb[]>>
  /** Programmatic launcher state: the open source name, or null. */
  readonly launcher: SnapshotStore<string | null>
  /** Hot reference lexicon grouped by trigger. */
  readonly lexicon: SnapshotStore<ReadonlyMap<string, readonly string[]>>
  /** Feed a draft/caret change through detection and drive the menu. */
  track(draft: string, caret: number, guard: TriggerGuard, draftRev: number): void
  /** Route a pointer or keyboard pick. */
  pick(source: string, index: number, action?: PickAction): void
  /** Route a pointer pick on one header crumb. */
  pickCrumb(source: string, index: number): void
  /** Route hover to the shared highlight. */
  hover(source: string, index: number): void
  /** Dismiss the open menu. */
  dismiss(): void
  /** Re-fetch the open menu without changing its hit or visible rows. */
  refreshOpenMenu(): void
  /** Keyboard arbitration while the menu is open. */
  arbitrate(key: Parameters<InputTriggerController['arbitrate']>[0], composing: boolean): ReturnType<InputTriggerController['arbitrate']>
  /** Adjudicate a space keystroke against the open menu; true when the menu consumed it. */
  onSpace(): boolean
  /** Open one source's menu programmatically (the launcher path). */
  toggleSource(source: string, hit: TriggerHit): void
  /** Release this Session's controller (closes the menu, aborts any fetch). */
  dispose(): void
}

/** The Native trigger service: source roster plus one controller per Session. */
export interface NativeInputTriggerService {
  /** Register one trigger source; (trigger, name) must be unique. */
  registerSource(source: InputTriggerSource): () => void
  /** Every registered source, in registration order. */
  sources(): readonly InputTriggerSource[]
  /** The selected Session's pipeline, or undefined when no Session is open. */
  current(): NativeInputTriggerSession | undefined
  /** One named Session's pipeline, creating it on first use. */
  sessionOf(sessionId: SessionId): NativeInputTriggerSession
  /** Subscribe to roster changes (a source added or removed). */
  subscribe(listener: () => void): () => void
  /** Release every controller and the host subscription. */
  dispose(): void
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** Trigger detection, candidate menu and pick routing for Native Clients. */
    clientNativeInputTrigger: NativeInputTriggerService
  }
}

/** Report every pick as unapplied: the honest answer when no input machine is mounted. */
const unclaimed: InputDispatch = () => false

/**
 * Give a controller the pick dispatch it needs without a Cordis context.
 *
 * `InputTriggerController.execute` reads `deps.actx.bail(...)`. Native has no
 * such context, so the controller is constructed with a stand-in `actx` whose
 * `bail` forwards to {@link InputDispatch}. This is the whole adapter: the
 * controller cannot tell the difference, and no part of the pipeline is copied.
 *
 * @param dispatch - the Native input machine's sender.
 * @returns the `actx` stand-in to pass as `deps.actx`.
 */
export function nativeActx(dispatch: InputDispatch): never {
  return {
    bail: (_subject: unknown, event: string, payload: Record<string, unknown>): boolean => {
      const kind = event === 'slash/input-begin-command' ? 'begin-command'
        : event === 'slash/input-insert-text' ? 'insert-text'
          : event === 'slash/input-insert-reference' ? 'insert-reference'
            : undefined
      // `consume-token` is the fourth Cordis slash event. The pick pipeline
      // never emits it, so it is not part of InputDispatchEvent; a caller that
      // did would get "unapplied" rather than a silent success.
      if (kind === undefined) return false
      return dispatch({ kind, request: payload })
    },
  } as never
}

/** Wrap an existing controller in the read face a Native menu surface consumes. */
function asSession(controller: InputTriggerController): NativeInputTriggerSession {
  return {
    menu: controller.menu,
    headers: controller.headers,
    launcher: controller.launcher,
    lexicon: controller.lexicon,
    track: (draft, caret, guard, draftRev) => { controller.track(draft, caret, guard, draftRev) },
    pick: (source, index, action) => { controller.pick(source, index, action) },
    pickCrumb: (source, index) => { controller.pickCrumb(source, index) },
    hover: (source, index) => { controller.hover(source, index) },
    dismiss: () => { controller.dismiss() },
    refreshOpenMenu: () => { controller.refreshOpenMenu() },
    arbitrate: (key, composing) => controller.arbitrate(key, composing),
    onSpace: () => controller.onSpace(),
    toggleSource: (source, hit) => { controller.toggleSource(source, hit) },
    dispose: () => { controller.dispose() },
  }
}

/**
 * Build the service over one Session read face and one Native dispatcher.
 *
 * @param sessions - the Native Conversation read face.
 * @param dispatch - sender for a pick's input mutation; omitted means nothing claims a pick.
 * @returns the service.
 */
export function createNativeInputTrigger(
  sessions: NativeSessionReadFace,
  dispatch: InputDispatch = unclaimed,
): NativeInputTriggerService {
  /** Registration order is menu group order, as in the Cordis service. */
  const roster: InputTriggerSource[] = []
  const controllers = new Map<SessionId, InputTriggerController>()
  const listeners = new Set<() => void>()
  let disposed = false

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[ui-input-trigger] roster listener failed:', error)
      }
    }
  }

  /** Wrapper cache: `sessionOf` must hand back the same object for the same Session. */
  const surfaces = new Map<SessionId, NativeInputTriggerSession>()

  const controllerFor = (sessionId: SessionId): InputTriggerController => {
    const existing = controllers.get(sessionId)
    if (existing !== undefined) return existing
    // The controller's own constructor prewarms every roster source, which is
    // the same warm the Cordis session scope performs at birth. Replaying
    // `sourceAdded` here as well would warm each source twice.
    const controller = new InputTriggerController({
      actx: nativeActx(dispatch),
      sessionId,
      roster: {
        sources: trigger => roster.filter(source => source.trigger === trigger)
          .sort((left, right) => (left.order ?? 0) - (right.order ?? 0)),
        all: () => roster,
      },
    })
    controllers.set(sessionId, controller)
    surfaces.set(sessionId, asSession(controller))
    return controller
  }

  const surfaceFor = (sessionId: SessionId): NativeInputTriggerSession => {
    controllerFor(sessionId)
    // `controllerFor` populated the cache.
    return surfaces.get(sessionId) as NativeInputTriggerSession
  }

  const releaseMissing = (): void => {
    if (disposed) return
    const present = new Set(sessions.getSnapshot().sessions.map(entry => entry.header.id))
    for (const [sessionId, controller] of controllers) {
      if (present.has(sessionId)) continue
      controller.dispose()
      controllers.delete(sessionId)
      surfaces.delete(sessionId)
    }
  }

  // A Session leaving the Host list must take its controller (and the fetches
  // hanging off it) with it; the Cordis build gets that from the scope fiber.
  const offSessions = sessions.subscribe(releaseMissing)

  const service: NativeInputTriggerService = {
    registerSource(source) {
      if (disposed) throw new Error('native input-trigger: service is disposed')
      if (roster.some(entry => entry.trigger === source.trigger && entry.name === source.name)) {
        throw new Error(`slash source "${source.trigger}${source.name}" is already registered`)
      }
      roster.push(source)
      for (const controller of controllers.values()) {
        try {
          controller.sourceAdded(source)
        } catch (error) {
          // Same containment rule as the Cordis service: a faulty source must
          // not take the registration, or the other controllers, down with it.
          console.error(`[ui-input-trigger] source "${source.trigger}${source.name}" late-registration setup failed:`, error)
        }
      }
      notify()
      return () => {
        const at = roster.indexOf(source)
        if (at < 0) return
        roster.splice(at, 1)
        for (const controller of controllers.values()) controller.sourceRemoved(source)
        notify()
      }
    },
    sources: () => [...roster],
    current() {
      const selected = sessions.getSnapshot().selected
      return selected === undefined ? undefined : surfaceFor(selected)
    },
    sessionOf: sessionId => surfaceFor(sessionId),
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose() {
      if (disposed) return
      disposed = true
      offSessions()
      for (const controller of controllers.values()) controller.dispose()
      controllers.clear()
      surfaces.clear()
      listeners.clear()
    },
  }

  return service
}

/** Native trigger pipeline Provider for independently installed Client modules. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-client-ui-input-trigger',
  targets: ['client'],
  requires: ['clientNativeConversation'],
  provides: ['clientNativeInputTrigger'],
  resolve: (input) => {
    if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length > 0)) {
      throw new TypeError('native input-trigger: this provider takes no configuration')
    }
    return (context) => {
      const conversation = context.require('clientNativeConversation')
      const service = createNativeInputTrigger(conversation)
      context.provide('clientNativeInputTrigger', service)
      context.own(() => { service.dispose() })
    }
  },
}

export type { InputTriggerCandidate, InputTriggerCrumb, InputTriggerSource, PickAction, TriggerGuard } from './types.ts'
export type { MenuState, TriggerHit } from './core/contract.ts'
export type { InputDispatch, InputDispatchEvent } from './client/native-dispatch.ts'
export { SLASH_INPUT_EVENTS } from './client/native-dispatch.ts'
