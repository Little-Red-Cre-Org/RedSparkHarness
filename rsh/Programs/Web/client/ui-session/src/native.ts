/** Session title and selected-scope projections for Native Client compositions. */
import type { ReactNode } from 'react'
import type {
  HostObservable,
  ScopedStandardSourceBinding,
  SlotScopeAdapter,
  StandardSourceBinding,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session/types'
import { workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'
import type { NativeSessionListItem } from '@deepseek-ai/dsh-client-native-session/native'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/native'
import { renderSessionArea } from './client/session-provider.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Actions adjacent to the Native Session presentation header. */
    'native.conversation.actions': { kind: 'list'; scope: 'root' }
  }
}

/** Native shell projection over the sole Native Conversation controller. */
export interface NativeSessionPresentation {
  /** Current title; undefined while no stored Session is selected. */
  readonly currentTitle: HostObservable<string | undefined>
  /** Apply the Native Session title and header projection to one listed Session. */
  displayTitle(session: NativeSessionListItem): string
}

/** Minimum Session facts needed by independently installed Native UI modules. */
export interface NativeConversationSnapshot {
  /** Currently selected durable Session header. */
  readonly header?: SessionHeader | undefined
  /** Host-ordered durable Session index. */
  readonly sessions: readonly NativeSessionListItem[]
  /** Selected identity, if any. */
  readonly selected?: SessionId | undefined
  /** Readiness of the sole Native Conversation controller. */
  readonly state: 'loading' | 'ready' | 'sending' | 'cancelling' | 'closed'
  /** Whether a new Session connection currently blocks composer submissions. */
  readonly navigationPending?: boolean | undefined
  /** Last rejected Native Session operation, when one is visible to the shell. */
  readonly error?: string | undefined
}

/** Apply the legacy display-label order to the Host title projection and Session header facts. */
function nativeSessionDisplayTitle(session: NativeSessionListItem): string {
  if (session.titleProjection.status === 'resolved') return session.titleProjection.title
  const directoryTitle = workspaceTitleOf(session.header.cwd ?? '')
  return directoryTitle === '' ? session.header.id : directoryTitle
}

/** UI-facing operations over the one Native Session controller. */
export interface NativeConversationService {
  /** Read the current controller snapshot. */
  getSnapshot(): NativeConversationSnapshot
  /** Subscribe to controller-owned state changes. */
  subscribe(listener: () => void): () => void
  /** Create and select a Host-owned Session. */
  create(): Promise<void>
  /** Clear the selected Session and return to the empty conversation state. */
  clear(): void
  /** Reserve the next navigation token.
   * @param disableSending - whether to block submissions while navigation resolves.
   * @returns next navigation token.
   */
  beginNavigation(disableSending?: boolean): number
  /** Check whether a navigation token is still current. */
  isCurrentNavigation(token: number): boolean
  /** Drop a Session's saved draft after it is archived or removed.
   * @param id - owning Session.
   */
  discardDraft(id: SessionId): void
  /** Wait for controller operations already in flight to settle.
   * @returns completion after no tracked operations remain pending.
   */
  idle(): Promise<void>
  /** Release a current navigation's composer lock without exposing an error.
   * @param token - navigation token whose composer lock should be released.
   * @returns no value.
   */
  releaseNavigation(token: number): void
  /** Clear a current navigation's sending lock and expose its failure.
   * @param token - navigation token that failed.
   * @param error - failure returned by the navigation operation.
   * @returns no value.
   */
  failNavigation(token: number, error: unknown): void
  /** Select an identity from the Host-owned Session index. */
  select(id: SessionId): Promise<void>
  /** Clear the selected Session and its conversation projection, detaching a running turn without cancelling it.
   * @returns completion after any detached turn's view settles.
   * @throws If another operation such as loading is pending.
   */
  deselect(): Promise<void>
  /** Pin a durable title through the selected Host owner. */
  renameTitle(id: SessionId, title: string): Promise<void>
  /** Refresh a durable title through the selected Host provider or fallback. */
  refreshTitle(id: SessionId): Promise<void>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** Sole Session and Agent UI authority supplied by Native Application. */
    clientNativeConversation: NativeConversationService
    /** Session-owned title source used by the Native shell frame. */
    clientNativeSessionPresentation: NativeSessionPresentation
  }
}

export type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Native Session presentation adapter; it does not own list or Session state. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-client-ui-session',
  targets: ['client'],
  requires: ['clientNativeConversation', 'clientSlots'],
  provides: ['clientNativeSessionPresentation'],
  resolve: () => (context) => {
    const conversation = context.require('clientNativeConversation')
    const slots = context.require('clientSlots')
    const scope = createNativeSessionScope(conversation)
    const removeScope = slots.installScope('session', scope.adapter)
    context.own(() => {
      scope.dispose()
      removeScope()
    })
    context.provide('clientNativeSessionPresentation', {
      displayTitle: nativeSessionDisplayTitle,
      currentTitle: {
        getSnapshot: () => {
          const snapshot = conversation.getSnapshot()
          if (snapshot.selected === undefined) return undefined
          const selected = snapshot.sessions.find(session => session.header.id === snapshot.selected)
          return selected === undefined ? undefined : nativeSessionDisplayTitle(selected)
        },
        subscribe: listener => conversation.subscribe(listener),
      },
    })
  },
}

interface NativeSessionScope {
  readonly adapter: SlotScopeAdapter
  dispose(): void
}

/** Build a read-only scope adapter over Native Conversation state. */
function createNativeSessionScope(conversation: NativeConversationService): NativeSessionScope {
  const bindings = new Map<SessionId, ScopedStandardSourceBinding>()
  const cleanups = new Map<SessionId, Set<() => void>>()
  const disposed = new Set<SessionId>()
  let isDisposed = false

  const bindingFor = (sessionId: SessionId): ScopedStandardSourceBinding => {
    const cached = bindings.get(sessionId)
    if (cached !== undefined) return cached
    disposed.delete(sessionId)
    const lifetimeIdentity = {}
    const lifetimeCleanups = new Set<() => void>()
    cleanups.set(sessionId, lifetimeCleanups)
    const item: HostObservable<NativeSessionListItem | undefined> = {
      getSnapshot: () => conversation.getSnapshot().sessions.find(session => session.header.id === sessionId),
      subscribe: listener => conversation.subscribe(listener),
    }
    const value: ScopedStandardSourceBinding = {
      key: sessionId,
      lifetime: {
        identity: lifetimeIdentity,
        onDispose: (dispose) => {
          if (disposed.has(sessionId) || isDisposed) dispose()
          else lifetimeCleanups.add(dispose)
        },
      },
      hooks: { nativeSession: item },
      keyedHooks: {},
      props: { nativeSessionId: sessionId },
    }
    bindings.set(sessionId, value)
    return value
  }

  const emptyBinding: StandardSourceBinding = {
    key: undefined,
    hooks: { nativeSession: undefined },
    keyedHooks: {},
    props: { nativeSessionId: undefined },
  }

  const releaseMissing = (): void => {
    const present = new Set<SessionId>(conversation.getSnapshot().sessions.map(session => session.header.id))
    for (const sessionId of bindings.keys()) {
      if (present.has(sessionId)) continue
      bindings.delete(sessionId)
      disposed.add(sessionId)
      const callbacks = cleanups.get(sessionId)
      cleanups.delete(sessionId)
      for (const dispose of callbacks ?? []) dispose()
    }
  }

  const current: HostObservable<StandardSourceBinding> = {
    getSnapshot: () => {
      const selected = conversation.getSnapshot().selected
      return selected === undefined || !hasSession(selected) ? emptyBinding : bindingFor(selected)
    },
    subscribe: listener => conversation.subscribe(() => {
      releaseMissing()
      listener()
    }),
  }

  const hasSession = (sessionId: SessionId): boolean =>
    conversation.getSnapshot().sessions.some(session => session.header.id === sessionId)

  const adapter: SlotScopeAdapter = {
    current,
    resolve: (key) => {
      const sessionId = conversation.getSnapshot().sessions.find(session => session.header.id === key)?.header.id
      return sessionId === undefined ? undefined : bindingFor(sessionId)
    },
    renderArea: (binding, props): ReactNode => renderSessionArea(binding, props),
  }

  return {
    adapter,
    dispose: () => {
      isDisposed = true
      for (const [sessionId, callbacks] of cleanups) {
        disposed.add(sessionId)
        for (const dispose of callbacks) dispose()
      }
      cleanups.clear()
      bindings.clear()
    },
  }
}
