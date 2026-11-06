// @vitest-environment jsdom
/**
 * The Native trigger menu.
 *
 * The browser renders this menu through a slot because its composer lives in
 * another package. A Native client has no such divide, so this surface reads the
 * pipeline's own store — and what it must not do is invent rows the browser
 * would not show.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@redspark/rsh-client-store'
import type { MenuState } from '../src/core/contract.ts'
import { NativeTriggerMenu, visibleGroups } from '../src/native-menu.tsx'

afterEach(cleanup)

const CLOSED: MenuState = { open: false, hit: null, generation: 0, groups: [], highlight: null }

function open(groups: MenuState['groups'], highlight: MenuState['highlight'] = null): MenuState {
  return { open: true, hit: { trigger: '@', query: '', quoted: false, position: 'inline', span: { start: 0, end: 1, draftRev: 1 } },
    generation: 1, groups, highlight }
}

function mount(state: MenuState) {
  const menu = createSnapshotStore<MenuState>(state)
  const pick = vi.fn()
  const hover = vi.fn()
  const dismiss = vi.fn()
  const view = render(<NativeTriggerMenu menu={menu} pick={pick} hover={hover} dismiss={dismiss} label="Suggestions" />)
  return { menu, pick, hover, dismiss, view }
}

describe('visibleGroups', () => {
  it('drops a ready group that answered nothing and keeps a pending one', () => {
    expect(visibleGroups(open([
      { source: 'reference', status: 'ready', items: [] },
      { source: 'command', status: 'pending', items: [] },
    ])).map(group => group.source)).toEqual(['command'])
  })
})

describe('NativeTriggerMenu', () => {
  it('renders nothing while the menu is closed', () => {
    const { view } = mount(CLOSED)
    expect(view.container.firstChild).toBeNull()
  })

  it('renders nothing when every group is empty', () => {
    const { view } = mount(open([{ source: 'reference', status: 'ready', items: [] }]))
    expect(view.container.firstChild).toBeNull()
  })

  it('renders one option per row and marks the shared highlight', () => {
    mount(open([
      { source: 'reference', status: 'ready', items: [
        { name: 'src/', icon: 'folder', description: 'parent', value: 'v1' },
        { name: 'a.md', icon: 'file', value: 'v2' },
      ] },
    ], { source: 'reference', index: 1 }))
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]?.getAttribute('aria-selected')).toBe('false')
    expect(options[1]?.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('src/')).toBeTruthy()
    expect(screen.getByText('parent')).toBeTruthy()
    expect(screen.getByText('a.md')).toBeTruthy()
  })

  it('routes a row press to the pipeline without stealing composer focus', () => {
    const { pick } = mount(open([
      { source: 'reference', status: 'ready', items: [{ name: 'src/', value: 'v1' }] },
    ]))
    const option = screen.getByRole('option')
    // preventDefault is what keeps the caret in the textarea, as the browser menu does.
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    option.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(pick).toHaveBeenCalledWith('reference', 0)
  })

  it('routes pointer movement to the shared highlight', () => {
    const { hover } = mount(open([
      { source: 'reference', status: 'ready', items: [{ name: 'src/', value: 'v1' }] },
    ]))
    fireEvent.mouseMove(screen.getByRole('option'))
    expect(hover).toHaveBeenCalledWith('reference', 0)
  })
})
