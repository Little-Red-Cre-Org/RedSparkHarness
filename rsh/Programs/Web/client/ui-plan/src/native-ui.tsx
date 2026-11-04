/**
 * Native entrypoint for the plan-mode status chip.
 *
 * The browser half reads the host-computed `plan` projection and leaves plan
 * mode by executing `/plan off` through the command channel. A Native Client
 * has neither: the Host owns plan mode per Session, and `clientNativeSession`
 * reads it as `modeControls.planMode` and writes it with `selectPlanMode`.
 * This plugin therefore reads and writes those Host facts directly and
 * contributes the browser half's chip into the Native Session action row.
 */
import { useEffect, useRef, useState } from 'react'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { SnapshotSelectorHook, TranslateNS } from '@redspark/rsh-client-ui-slots'
import type { NativeSessionClient } from '@redspark/rsh-client-native-session/native'
import type { SessionId } from '@redspark/rsh-session/types'
import { createSnapshotStore, type SnapshotStore } from '@redspark/rsh-client-store'
import type {} from '@redspark/rsh-client-ui-renderer/native'
import type {} from '@redspark/rsh-client-ui-session/native'
import type {} from '@redspark/rsh-client-native-session/native'
import type {} from '@redspark/rsh-client-locale/native'
import { IconCloseFill14 } from '@redspark/rsh-client-ui-primitives'
import css from './client/PlanModeControl.module.css'
import { en, zh } from './client/locales.ts'

export { en, zh } from './client/locales.ts'
export type { PlanKey } from './client/locales.ts'

/** Dictionary namespace owned by this plugin, shared with the browser half. */
const NS = 'plan'

/** Host plan-mode facts for one Session, as the chip renders them. */
export type NativePlanState = Awaited<ReturnType<NativeSessionClient['modeControls']>>['planMode']

/** Props the chip receives from the Session action row. */
export interface NativePlanChipProps {
  /** Host plan-mode facts for the selected Session; undefined until the first read settles. */
  readonly usePlan: SnapshotSelectorHook<NativePlanState | undefined>
  /**
   * Leave plan mode through the Host's Session controls.
   * @returns null once the Host accepted the change; a user-visible failure line otherwise.
   */
  readonly exitPlanMode: () => Promise<string | null>
  /** Namespace translator supplied by the slot. */
  readonly t: TranslateNS<typeof NS>
}

/**
 * Plan-mode status over the Host's per-Session plan facts.
 *
 * The chip renders only while the effective target is plan mode
 * (`pending ? !active : active` — a folded Host value, never client optimism),
 * and `available` gates it: a Host without plan mode has nothing to describe.
 * @param props - the plan hook, the exit callback and the translator.
 * @returns the warn-colored status chip, or null while plan mode is not the target.
 */
export function NativePlanChip({ usePlan, exitPlanMode, t }: NativePlanChipProps) {
  const plan = usePlan(value => value)
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  if (plan === undefined || plan.available !== true) return null
  const target = plan.pending === true ? !plan.active : plan.active
  if (!target) return null

  const off = (): void => {
    // No leaving guard in the handler: the disabled attribute is what stops a
    // second click, and it is set before the Host round trip starts.
    setLeaving(true)
    setError(null)
    void exitPlanMode().then((failure) => {
      if (!aliveRef.current) return
      setLeaving(false)
      setError(failure)
    }, (reason: unknown) => {
      if (!aliveRef.current) return
      setLeaving(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <span className={css.wrap}>
      <button
        type="button"
        className={css.chip}
        aria-label={t('chip.on.aria')}
        title={t('chip.on.title')}
        disabled={leaving}
        onClick={off}
      >
        {t('chip.label')}
        <span className={css.close} aria-hidden>
          <IconCloseFill14 size={12} />
        </span>
      </button>
      {error !== null && <span className={css.error} role="status" title={error}>{t('chip.exitFailed')}</span>}
    </span>
  )
}

/** The selected-Session facts this plugin follows. */
interface SelectedSession {
  getSnapshot(): { readonly selected?: SessionId | undefined }
  subscribe(listener: () => void): () => void
}

/**
 * Follow the selected Session's plan state by reading the Host on each change.
 *
 * The Host pushes no plan-mode stream, so the source is refreshed at selection
 * and after each write this plugin makes. A plan-mode change made by another
 * Native surface becomes visible at the next selection change.
 * @param client - the Native Session client.
 * @param conversation - the selected-Session owner.
 * @param signal - the installation's lifetime.
 * @returns the plan source.
 */
function followPlan(
  client: Pick<NativeSessionClient, 'modeControls'>,
  conversation: SelectedSession,
  signal: AbortSignal,
): SnapshotStore<NativePlanState | undefined> {
  const store = createSnapshotStore<NativePlanState | undefined>(undefined)
  let current = conversation.getSnapshot().selected
  const read = async (sessionId: SessionId): Promise<void> => {
    try {
      const controls = await client.modeControls(sessionId, signal)
      if (signal.aborted || conversation.getSnapshot().selected !== sessionId) return
      store.set(controls.planMode)
    } catch (error: unknown) {
      // A Host without plan mode answers normally; a rejection here is a
      // transport fault the shell reports elsewhere, so the chip stays hidden.
      if (!signal.aborted) console.error('native plan chip: reading plan mode failed', error)
    }
  }
  if (current !== undefined) void read(current)
  conversation.subscribe(() => {
    const next = conversation.getSnapshot().selected
    if (next === current) return
    current = next
    store.set(undefined)
    if (next !== undefined) void read(next)
  })
  return store
}

/** Native plan-mode chip: contributes the browser half's status control to the Session action row. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-client-ui-plan',
  targets: ['client'],
  requires: ['clientSlots', 'clientLocale', 'clientNativeConversation', 'clientNativeSession'],
  optional: [],
  provides: [],
  resolve: () => (context) => {
    const slots = context.require('clientSlots')
    const locale = context.require('clientLocale')
    const conversation = context.require('clientNativeConversation')
    const client = context.require('clientNativeSession')
    context.own(locale.register(NS, { en, zh }))
    const plan = followPlan(client, conversation, context.signal)
    context.own(slots.inject('native.conversation.actions', () => slots.register({
      name: 'native.conversation.actions',
      id: 'plan-mode',
      // Between the shell's own Session actions and the background-job list.
      order: 10,
      locale: NS,
      inject: () => ({
        hooks: { plan },
        exitPlanMode: async (): Promise<string | null> => {
          const sessionId = conversation.getSnapshot().selected
          if (sessionId === undefined) return null
          try {
            const selection = await client.selectPlanMode(sessionId, false, context.signal)
            if (!context.signal.aborted && conversation.getSnapshot().selected === sessionId) {
              plan.set({
                available: true,
                active: selection.active,
                ...selection.pending === undefined ? {} : { pending: selection.pending },
              })
            }
            return null
          } catch (reason: unknown) {
            return reason instanceof Error ? reason.message : String(reason)
          }
        },
      }),
    }, ({ usePlan, exitPlanMode, t }: {
      usePlan: SnapshotSelectorHook<NativePlanState | undefined>
      exitPlanMode: () => Promise<string | null>
      t: TranslateNS<typeof NS>
    }) => <NativePlanChip usePlan={usePlan} exitPlanMode={exitPlanMode} t={t} />)))
  },
}
