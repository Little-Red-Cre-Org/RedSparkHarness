/**
 * The Native trigger menu.
 *
 * The browser renders this through a slot because its composer lives in a
 * different package. A Native client has no such divide: the pipeline that owns
 * the menu state is installed here, so this surface subscribes to it directly
 * and mounts itself into the conversation's action row. Rendering the same
 * store keeps the two builds from drifting on what a row says.
 *
 * @module @redspark/rsh-client-ui-input-trigger/native-menu
 */
import { useRef, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { ReferenceIcon, useAnchoredMaxHeight } from '@redspark/rsh-client-ui-primitives'
import type { MenuState } from './core/contract.ts'
import type { InputTriggerCandidate } from './types.ts'

/** Height cap matching the browser menu. */
const MAX_HEIGHT = 400

/** One rendered group, reduced from the menu store. */
interface RenderedGroup {
  readonly source: string
  readonly items: readonly InputTriggerCandidate[]
}

/**
 * Read the groups worth showing: a ready group with no rows is dropped, so a
 * source that answered nothing takes no space.
 * @param state - current menu state.
 * @returns the groups to render, in roster order.
 */
export function visibleGroups(state: MenuState): readonly RenderedGroup[] {
  return state.groups
    .filter(group => group.status !== 'ready' || group.items.length > 0)
    .map(group => ({ source: group.source, items: group.items }))
}

/**
 * Render the candidate menu for one Session's pipeline.
 * @param props.menu - the Session's menu snapshot store.
 * @param props.pick - route a row pick back through the pipeline.
 * @param props.hover - route pointer hover to the shared highlight.
 * @param props.dismiss - close the menu.
 * @param props.label - accessible name for the listbox.
 * @returns the menu, or null while it is closed or empty.
 */
export function NativeTriggerMenu({ menu, pick, hover, dismiss, label }: {
  readonly menu: { getSnapshot(): MenuState; subscribe(listener: () => void): () => void }
  readonly pick: (source: string, index: number, action?: 'pick' | 'drill') => void
  readonly hover: (source: string, index: number) => void
  readonly dismiss: () => void
  readonly label: string
}): ReactNode {
  const state = useSyncExternalStore(store => menu.subscribe(store), () => menu.getSnapshot())
  const listRef = useRef<HTMLDivElement>(null)
  const maxHeight = useAnchoredMaxHeight(listRef, MAX_HEIGHT, state)
  if (!state.open) return null
  const groups = visibleGroups(state)
  if (groups.length === 0) return null
  const highlight = state.highlight
  return (
    <div ref={listRef} className="dsh-native-trigger-menu" style={{ maxHeight }} role="listbox" aria-label={label}>
      {groups.map(group => group.items.map((item, index) => {
        const active = highlight !== null && highlight.source === group.source && highlight.index === index
        return (
          <button
            key={`${group.source}:${String(index)}`}
            type="button"
            role="option"
            aria-selected={active}
            data-active={active || undefined}
            // mousedown keeps focus in the composer, as the browser menu does.
            onMouseDown={(event) => { event.preventDefault(); pick(group.source, index) }}
            onMouseMove={() => { hover(group.source, index) }}
          >
            {item.icon === undefined ? null : (
              <span aria-hidden>
                {typeof item.icon === 'string' ? <ReferenceIcon kind={item.icon} size={16} /> : <item.icon size={16} />}
              </span>
            )}
            <span>{item.label ?? item.name}</span>
            {item.description === undefined ? null : <span>{item.description}</span>}
          </button>
        )
      }))}
      <button type="button" aria-label={label} onClick={dismiss} />
    </div>
  )
}
