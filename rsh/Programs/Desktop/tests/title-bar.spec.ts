// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { installTitleBar } from '../src/title-bar.ts'
import { DESKTOP_IPC } from '../src/ipc.ts'

const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('electron', () => ({ ipcRenderer: { invoke } }))

afterEach(() => {
  window.dispatchEvent(new Event('unload'))
  document.head.replaceChildren()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('keeps Web documents and other platforms free of desktop chrome', () => {
  vi.stubGlobal('process', { ...process, platform: 'linux' })
  installTitleBar()
  vi.stubGlobal('process', { ...process, platform: 'win32' })
  vi.stubGlobal('location', new URL('https://example.com'))
  installTitleBar()
  window.dispatchEvent(new Event('DOMContentLoaded'))
  expect(document.querySelector('#sph-title-bar')).toBeNull()
})

it('renders a keyboard-accessible menu and synchronizes resolved theme colors', async () => {
  vi.stubGlobal('process', { ...process, platform: 'win32' })
  vi.stubGlobal('location', new URL('dsh-app://app/index.html'))
  vi.stubGlobal('getComputedStyle', () => ({ backgroundColor: 'rgb(255, 248, 248)', color: 'rgb(48, 35, 42)' }))
  installTitleBar()
  window.dispatchEvent(new Event('DOMContentLoaded'))
  const button = document.querySelector<HTMLButtonElement>('#sph-title-bar button')!
  expect(button.textContent).toContain('RedSpark Harness')
  expect(button.querySelector('img')?.getAttribute('src')).toBe('/redspark.svg')
  expect(button.getAttribute('aria-haspopup')).toBe('menu')
  button.click()
  expect(invoke).toHaveBeenCalledWith(DESKTOP_IPC.windowMenu)
  expect(invoke).toHaveBeenCalledWith(DESKTOP_IPC.windowColors, '#fff8f8', '#30232a')
  vi.stubGlobal('getComputedStyle', () => ({ backgroundColor: 'rgb(28, 23, 28)', color: 'rgb(237, 237, 240)' }))
  document.body.setAttribute('data-ds-dark-theme', '')
  await Promise.resolve()
  expect(invoke).toHaveBeenCalledWith(DESKTOP_IPC.windowColors, '#1c171c', '#ededf0')
})
