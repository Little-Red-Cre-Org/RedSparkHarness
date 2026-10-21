// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest'
import { connectWorkbenchAppearance } from '../src/client/workbench-appearance.ts'

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren() })

it.each(['light', 'dark', 'foreign-parent', 'invalid-color'] as const)('embedded theme: %s', async (mode) => {
  vi.stubGlobal('location', new URL('dsh-app://ide-test/index.html?channel=private'))
  vi.stubGlobal('CSS', { supports: (_property: string, value: string) => /^#[\da-f]{6}$/iu.test(value) })
  const frame = document.createElement('div')
  document.body.append(frame)
  const dispose = connectWorkbenchAppearance(frame)
  const background = mode === 'dark' ? '#201a20' : '#fffdfa'
  const message = new MessageEvent('message', {
    source: mode === 'foreign-parent' ? null : window,
    data: { type: 'appearance', channel: 'private', dark: mode === 'dark',
      colors: [mode === 'invalid-color' ? 'url(example)' : background, '#43313d', '#857781', '#ae354b', '#f6f5f3', '#e9e6e3'] },
  })
  try {
    window.dispatchEvent(message)
    if (mode === 'foreign-parent' || mode === 'invalid-color') {
      expect(frame.getAttribute('style')).toBeNull()
    } else {
      expect(frame.style.getPropertyValue('--dsw-alias-bg-base')).toBe(background)
      expect(frame.style.colorScheme).toBe(mode)
      await expect(frame.getAttribute('style')).toMatchFileSnapshot(`./expected/workbench-${mode}.txt`)
      expect(document.body.getAttribute('style')).toBeNull()
    }
  } finally { dispose() }
  expect(frame.style.getPropertyValue('--dsw-alias-bg-base')).toBe('')
  window.dispatchEvent(message)
  expect(frame.style.getPropertyValue('--dsw-alias-bg-base')).toBe('')
})
