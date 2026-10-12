// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ModelPickerControl } from '../src/model-controls.tsx'
import type { ConversationSnapshot } from '../src/controller.ts'
import type { ConversationLocaleKey } from '../src/locales.ts'

afterEach(cleanup)

it('keeps initial catalog failures retryable before a Session is selected', async () => {
  const snapshot: ConversationSnapshot = {
    sessions: [], events: [], state: 'ready', error: 'catalog offline',
  }
  const refreshModelControls = vi.fn(async () => undefined)
  const t = (key: ConversationLocaleKey, params?: Record<string, unknown>): string =>
    key === 'error.action' ? `Failed: ${String(params?.message)}` : key

  render(<ModelPickerControl snapshot={snapshot} selectModel={async () => undefined}
    refreshModelControls={refreshModelControls} t={t} />)

  const trigger = screen.getByRole<HTMLButtonElement>('button', { name: 'trigger.selectAria' })
  expect(trigger.disabled).toBe(false)
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('menuitem', { name: /menu\.model/ }))
  expect(await screen.findByText('Failed: catalog offline')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'retry' }))

  expect(refreshModelControls).toHaveBeenCalledTimes(2)
})
