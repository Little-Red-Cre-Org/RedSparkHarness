// @vitest-environment jsdom
/**
 * Native plan-mode chip.
 *
 * The browser half renders from the host-computed `plan` projection and leaves
 * plan mode through `/plan off`. This Native half renders from the Session
 * controller's Host-owned `modeControls.planMode` and writes through
 * `selectPlanMode`, so what this suite pins is that substitution: the same
 * effective-target rule, the same exit affordance, and the Host round trip the
 * click performs.
 */
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@redspark/rsh-client-test-runtime'
import { NativePlanChip, plugin, type NativePlanState } from '../src/native.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh)

/** The one live plan state the exit cases render over. */
const activePlan: NativePlanState = { available: true, active: true }

/**
 * Build the selector hook a slot would hand the component.
 *
 * The snapshot must be reference-stable: `useSyncExternalStore` resubscribes on
 * every read that returns a new object, which would loop forever.
 */
function hookFor(plan: NativePlanState | undefined) {
  return (<T,>(selector: (value: NativePlanState | undefined) => T): T =>
    useSyncExternalStore(() => () => {}, () => selector(plan))) as never
}

/** Render the chip over one fixed plan state, recording the exit call. */
function mount(plan: NativePlanState | undefined) {
  const exitPlanMode = vi.fn(() => Promise.resolve<string | null>(null))
  const view = render(<NativePlanChip usePlan={hookFor(plan)} exitPlanMode={exitPlanMode} t={t} />)
  return { ...view, exitPlanMode }
}

describe('NativePlanChip visibility', () => {
  it('renders nothing until the Host reports plan mode', () => {
    const { container } = mount(undefined)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing while plan mode is unavailable or off', () => {
    expect(mount({ available: false, active: true }).container.innerHTML).toBe('')
    expect(mount({ available: true, active: false }).container.innerHTML).toBe('')
  })

  it('renders the chip while plan mode is the effective target', () => {
    mount({ available: true, active: true })
    expect(screen.getByRole('button', { name: zh['chip.on.aria'] })).toBeDefined()
  })

  it('treats a pending exit as already off, and a pending entry as already on', () => {
    // The Host reports the committed value; `pending` is the requested one, so
    // the chip follows the request rather than the stale commitment.
    expect(mount({ available: true, active: true, pending: true }).container.innerHTML).toBe('')
    expect(mount({ available: true, active: false, pending: true }).container.innerHTML).not.toBe('')
  })
})

describe('NativePlanChip exit', () => {
  it('leaves plan mode through the Host and disables itself while the round trip runs', async () => {
    const settle = Promise.withResolvers<string | null>()
    const exitPlanMode = vi.fn(() => settle.promise)
    render(<NativePlanChip usePlan={hookFor(activePlan)} exitPlanMode={exitPlanMode} t={t} />)

    const chip = screen.getByRole('button', { name: zh['chip.on.aria'] })
    fireEvent.click(chip)
    expect(exitPlanMode).toHaveBeenCalledOnce()
    expect(chip.hasAttribute('disabled')).toBe(true)

    await act(async () => { settle.resolve(null) })
    expect(chip.hasAttribute('disabled')).toBe(false)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('reports a rejected Host call as the localized failure line', async () => {
    const exitPlanMode = vi.fn(() => Promise.reject(new Error('plan mode unavailable')))
    render(<NativePlanChip usePlan={hookFor(activePlan)} exitPlanMode={exitPlanMode} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: zh['chip.on.aria'] }))
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe(zh['chip.exitFailed']) })
    expect(screen.getByRole('status').getAttribute('title')).toBe('plan mode unavailable')
  })

  it('reports a returned failure line and clears it on the next attempt', async () => {
    const exitPlanMode = vi.fn((): Promise<string | null> => Promise.resolve('boom'))
    render(<NativePlanChip usePlan={hookFor(activePlan)} exitPlanMode={exitPlanMode} t={t} />)

    const chip = screen.getByRole('button', { name: zh['chip.on.aria'] })
    fireEvent.click(chip)
    await waitFor(() => { expect(screen.getByRole('status').getAttribute('title')).toBe('boom') })

    exitPlanMode.mockResolvedValueOnce(null)
    fireEvent.click(chip)
    await waitFor(() => { expect(screen.queryByRole('status')).toBeNull() })
  })
})

describe('NativePlanChip installation', () => {
  it('declares the Native services it binds and provides none', () => {
    expect(plugin.name).toBe('@redspark/rsh-client-ui-plan')
    expect(plugin.apiVersion).toBe(1)
    expect(plugin.targets).toEqual(['client'])
    expect(plugin.requires).toEqual([
      'clientSlots', 'clientLocale', 'clientNativeConversation', 'clientNativeSession',
    ])
    expect(plugin.provides).toEqual([])
    expect(plugin.optional).toEqual([])
  })
})
