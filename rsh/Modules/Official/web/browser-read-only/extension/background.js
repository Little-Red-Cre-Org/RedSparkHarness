/** Browser-owned grants; only the extension popup may connect, authorize, or revoke. */
import { messages } from './locale.js'

let port
let connected = false
let limit = 0
let notice = ''
const grants = new Map()
const reads = new Map()

function reset(message) {
  connected = false; grants.clear(); reads.clear(); notice = message
}

function revoke(id) {
  if (!grants.delete(id)) return
  if (connected) port.postMessage({ type: 'revoke', id })
}

// Injected in the isolated world without touching the page's DOM, forms or storage.
function extractText(maxTextChars) {
  const root = document.querySelector('main, article, [role="main"]') ?? document.body
  if (!root) return { url: location.href, title: document.title.slice(0, 1024), text: '', truncated: false }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const excluded = 'script,style,noscript,template,input,textarea,select,option,button,[hidden],[aria-hidden="true"],[contenteditable]'
  const parts = []
  let length = 0
  let visited = 0
  let node = walker.nextNode()
  while (node && length < maxTextChars && visited < maxTextChars) {
    visited++
    const parent = node.parentElement
    if (parent && !parent.closest(excluded)
      && parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
      const text = node.textContent.replace(/\s+/gu, ' ').trim()
      if (text) {
        const piece = (parts.length ? '\n' : '') + text
        const remaining = maxTextChars - length
        parts.push(piece.slice(0, remaining)); length += Math.min(piece.length, remaining)
        if (piece.length > remaining) break
      }
    }
    node = walker.nextNode()
  }
  return { url: location.href, title: document.title.slice(0, 1024), text: parts.join(''), truncated: node !== null }
}

async function read(message, owner) {
  if (typeof message.requestId !== 'string' || typeof message.grantId !== 'string'
    || !Number.isSafeInteger(message.maxTextChars) || message.maxTextChars < 1 || message.maxTextChars > 100000) {
    owner.disconnect(); return
  }
  const grant = grants.get(message.grantId)
  if (!grant) { owner.postMessage({ type: 'error', requestId: message.requestId, code: 'REVOKED' }); return }
  const ticket = {}
  reads.set(message.requestId, ticket)
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: grant.tabId, documentIds: [grant.documentId] },
      func: extractText, args: [message.maxTextChars],
    })
    const result = results[0]
    const tab = await chrome.tabs.get(grant.tabId)
    if (reads.get(message.requestId) !== ticket || port !== owner || !connected) return
    if (grants.get(message.grantId) !== grant || !result || result.documentId !== grant.documentId
      || result.result?.url !== grant.url || tab.url !== grant.url) {
      revoke(grant.id)
      owner.postMessage({ type: 'error', requestId: message.requestId, code: 'PAGE_CHANGED' })
      return
    }
    owner.postMessage({ type: 'result', requestId: message.requestId, grantId: grant.id, ...result.result })
  } catch {
    // Restricted or replaced documents are reported without browser diagnostics or page credentials.
    if (reads.get(message.requestId) === ticket && port === owner && connected) {
      revoke(grant.id)
      owner.postMessage({ type: 'error', requestId: message.requestId, code: 'READ_FAILED' })
    }
  } finally { if (reads.get(message.requestId) === ticket) reads.delete(message.requestId) }
}

function connect() {
  if (port) return
  notice = ''
  const owner = chrome.runtime.connectNative('com.redspark.harness.readonly')
  port = owner
  owner.onMessage.addListener(message => {
    if (port !== owner) return
    if (message.type === 'connected' && Number.isSafeInteger(message.maxGrants)) {
      connected = true; limit = message.maxGrants
    } else if (message.type === 'read' && connected) {
      void read(message, owner)
    } else if (message.type === 'cancel') {
      reads.delete(message.requestId)
    } else {
      owner.disconnect(); port = undefined; reset(messages.invalidConnection)
    }
  })
  owner.onDisconnect.addListener(() => {
    const failed = chrome.runtime.lastError !== undefined
    if (port !== owner) return
    port = undefined; reset(failed ? messages.connectionFailed : messages.disconnected)
  })
}

async function authorize() {
  if (!connected) throw new Error(messages.connectFirst)
  const owner = port
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url) throw new Error(messages.unsupportedPage)
  const url = new URL(tab.url)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || tab.url.length > 4096) {
    throw new Error(messages.unsupportedPage)
  }
  const [document] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => location.href })
  const current = await chrome.tabs.get(tab.id)
  if (!connected || owner !== port || current.url !== tab.url || document?.result !== tab.url || !document.documentId) {
    throw new Error(messages.pageChanged)
  }
  const previous = [...grants.values()].find(grant => grant.tabId === tab.id)
  if (!previous && grants.size >= limit) throw new Error(messages.grantLimit)
  if (previous) revoke(previous.id)
  const grant = { id: crypto.randomUUID(), tabId: tab.id, documentId: document.documentId,
    url: tab.url, title: (tab.title ?? '').slice(0, 1024) }
  grants.set(grant.id, grant)
  owner.postMessage({ type: 'grant', grant: { id: grant.id, url: grant.url, title: grant.title } })
}

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url && change.status !== 'loading') return
  for (const grant of grants.values()) if (grant.tabId === tabId) revoke(grant.id)
})
chrome.tabs.onRemoved.addListener(tabId => {
  for (const grant of grants.values()) if (grant.tabId === tabId) revoke(grant.id)
})
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return false
  void (async () => {
    try {
      if (message.type === 'connect') connect()
      else if (message.type === 'authorize') await authorize()
      else if (message.type === 'revoke') revoke(message.id)
      else if (message.type === 'disconnect') {
        const owner = port; port = undefined; reset(messages.disconnected); owner?.disconnect()
      } else if (message.type !== 'status') throw new Error(messages.readOnly)
      respond({ connected, connecting: !!port && !connected, notice,
        pages: [...grants.values()].map(({ id, title, url }) => ({ id, title, url })) })
    } catch (error) { respond({ error: error.message }) }
  })()
  return true
})
