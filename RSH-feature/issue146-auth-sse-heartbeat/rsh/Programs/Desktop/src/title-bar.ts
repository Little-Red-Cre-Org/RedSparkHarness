/** Isolated desktop chrome; no window-control API is exposed to application JavaScript. */
import { ipcRenderer } from 'electron'
import { DESKTOP_IPC } from './ipc.ts'
import { resolveDesktopLocale } from './locale.ts'

/**
 * Install Windows chrome after the document loads; other platforms keep their system frame.
 * The preload owns the menu listener and observes the application's resolved theme.
 */
export function installTitleBar(): void {
  if (process.platform !== 'win32' || location.protocol !== 'dsh-app:') return
  window.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('link')
    style.rel = 'stylesheet'
    style.href = '/sph-title-bar.css'
    document.head.append(style)
    const bar = document.createElement('header')
    bar.id = 'sph-title-bar'
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('aria-label', resolveDesktopLocale(navigator.language).messages.application)
    button.setAttribute('aria-haspopup', 'menu')
    const logo = document.createElement('img')
    logo.src = '/redspark.svg'
    logo.alt = ''
    logo.className = 'spark'
    button.append(logo)
    for (const [className, text] of [['brand', 'RedSpark Harness'], ['chevron', '▾']] as const) {
      const span = document.createElement('span')
      span.className = className
      span.textContent = text
      span.setAttribute('aria-hidden', 'true')
      button.append(span)
    }
    button.addEventListener('click', () => {
      void ipcRenderer.invoke(DESKTOP_IPC.windowMenu).catch(console.error)
    })
    bar.append(button)
    document.body.append(bar)
    let previous = ''
    const syncColors = (): void => {
      const computed = getComputedStyle(bar)
      const hex = (color: string): string | undefined => {
        const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(color)
        return match === null ? undefined : `#${match.slice(1).map(value => Number(value).toString(16).padStart(2, '0')).join('')}`
      }
      const background = hex(computed.backgroundColor)
      const foreground = hex(computed.color)
      if (background === undefined || foreground === undefined || previous === background + foreground) return
      previous = background + foreground
      void ipcRenderer.invoke(DESKTOP_IPC.windowColors, background, foreground).catch(console.error)
    }
    const observer = new MutationObserver(syncColors)
    style.addEventListener('load', syncColors, { once: true })
    observer.observe(document.body, { attributes: true, attributeFilter: ['style', 'data-ds-dark-theme'] })
    observer.observe(document.head, { childList: true, subtree: true, attributes: true })
    syncColors()
    window.addEventListener('unload', () => { observer.disconnect() }, { once: true })
  }, { once: true })
}
