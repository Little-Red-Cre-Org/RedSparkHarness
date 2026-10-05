/** Explicit native Web page entry; the legacy Loader is loaded only by index.html. */
import { BootPage } from '@deepseek-ai/dsh-client-web/boot-page'
import { bootNativeClientEntry } from './native-entry.ts'

const container = document.getElementById('root')
if (container === null) throw new Error('native web: missing #root')
const root = container
const page = new BootPage(root)
const injected = (globalThis as { __DSH_NATIVE_CLIENT_BOOT__?: unknown }).__DSH_NATIVE_CLIENT_BOOT__

function showFailure(reason: unknown): void {
  root.dataset.nativeBootState = 'failed'
  page.fail(reason instanceof Error ? reason.message : String(reason))
  console.error(reason)
}

if (injected === undefined) {
  showFailure(new Error('native web: Host did not inject Client profile data'))
} else {
  const lifetime = new AbortController()
  let stopHost: (() => Promise<void>) | undefined
  window.addEventListener('pagehide', () => {
    lifetime.abort(new Error('native web: page is unloading'))
    page.dispose()
    if (stopHost !== undefined) {
      void stopHost().catch((error: unknown) => { console.error('native web: host cleanup failed', error) })
    }
  }, { once: true })

  void bootNativeClientEntry(root, injected, document.baseURI, undefined, lifetime.signal, page).then((host) => {
    stopHost = () => host.stop()
    page.dispose()
    root.dataset.nativeBootState = 'ready'
  }).catch((reason: unknown) => {
    if (!lifetime.signal.aborted) showFailure(reason)
  })
}
