/** Popup controls use extension messages and render all page metadata as text. */
import { messages } from './locale.js'
document.documentElement.lang = chrome.i18n.getUILanguage()
for (const element of document.querySelectorAll('[data-copy]')) element.textContent = messages[element.dataset.copy]
let pending
let renderedPages = ''
async function command(type, id) {
  if (type === 'status' && pending) return
  const previous = pending
  const operation = (async () => {
    await previous
    try {
      const state = await chrome.runtime.sendMessage({ type, ...(id ? { id } : {}) })
      if (state.error) { document.querySelector('#error').textContent = state.error; return }
      if (type !== 'status') document.querySelector('#error').textContent = ''
      document.querySelector('#status').textContent = state.notice || (state.connected ? messages.connected : state.connecting ? messages.connecting : messages.disconnected)
      document.querySelector('#connect').disabled = state.connected || state.connecting
      document.querySelector('#authorize').disabled = !state.connected
      document.querySelector('#disconnect').disabled = !state.connected && !state.connecting
      const pages = JSON.stringify(state.pages)
      if (pages === renderedPages) return
      renderedPages = pages
      const list = document.querySelector('#pages')
      list.replaceChildren()
      if (!state.pages.length) list.textContent = messages.empty
      for (const page of state.pages) {
        const row = document.createElement('li'), title = document.createElement('b'), url = document.createElement('small'), button = document.createElement('button')
        title.textContent = page.title; url.textContent = page.url; button.textContent = messages.revoke
        button.addEventListener('click', () => { void command('revoke', page.id) })
        row.append(title, url, button); list.append(row)
      }
    } catch { document.querySelector('#error').textContent = messages.connectionFailed }
  })()
  pending = operation
  await operation
  if (pending === operation) pending = undefined
}
for (const type of ['connect', 'authorize', 'disconnect']) document.querySelector(`#${type}`).addEventListener('click', () => { void command(type) })
void command('status')
const timer = setInterval(() => { void command('status') }, 750)
window.addEventListener('pagehide', () => { clearInterval(timer) }, { once: true })
