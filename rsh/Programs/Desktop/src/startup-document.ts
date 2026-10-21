/** Self-contained Desktop preparation and recovery documents. */

import type { DesktopLocale, DesktopMessages } from './locale.ts'

const escape = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

/**
 * Display IDE preparation in the workbench view until its navigation commits.
 * @param messages - Shell-owned translations.
 * @returns A self-contained document requiring no network requests or scripts.
 */
export function ideLoadingDocument(messages: DesktopMessages): string {
  return `<!doctype html><html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escape(messages.ideWindowTitle)}</title>
<style>
:root{font-family:system-ui,"Segoe UI",sans-serif;color:#382c30;background:#fffafa}
body{margin:0;min-height:100vh;display:grid;place-items:center}
main{padding:40px;max-width:460px;text-align:center}
.brand{color:#ba3150;font-size:13px;letter-spacing:.16em;margin-bottom:32px}
.spinner{width:30px;height:30px;border:3px solid #f0dce2;border-top-color:#ba3150;border-radius:50%;margin:0 auto 24px;animation:spin 1s linear infinite}
h1{font-size:24px;font-weight:600;margin:0 0 12px}p{color:#82747a;font-size:14px;line-height:1.8;margin:0}
@keyframes spin{to{transform:rotate(360deg)}}
@media(prefers-color-scheme:dark){:root{color:#eee5e8;background:#20191d}p{color:#b8a8af}.brand{color:#f19aae}.spinner{border-color:#50313d;border-top-color:#f19aae}}
@media(prefers-reduced-motion:reduce){.spinner{animation:none}}
</style><main role="status"><div class="brand">REDSPARK HARNESS</div><div class="spinner" aria-hidden="true"></div>
<h1>${escape(messages.ideLoading)}</h1><p>${escape(messages.ideLoadingDescription)}</p></main></html>`
}

/**
 * Render escaped diagnostics without depending on application resource files.
 * @param locale - Shell-owned translations.
 * @param message - Failure details displayed as plain text.
 * @param profileRecovery - Whether the initialized application can repair its profile.
 * @returns An HTML document suitable for an isolated emergency window.
 */
export function startupFailureDocument(locale: DesktopLocale, message: string, profileRecovery = false): string {
  return `<!doctype html><html lang="${locale.id}"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action dsh-recovery:">
<title>${escape(locale.messages.startupFailed)}</title>
<style>:root{color-scheme:light dark;font-family:system-ui}body{max-width:720px;margin:10vh auto;padding:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}.window-drag{position:fixed;top:0;left:0;right:148px;height:40px;-webkit-app-region:drag}</style>
<div class="window-drag" aria-hidden="true"></div>
<main><h1>${escape(locale.messages.startupFailed)}</h1><p>${escape(locale.messages.startupReinstallAdvice)}</p>
${profileRecovery ? `<p>${escape(locale.messages.startupConfigurationAdvice)}</p>` : ''}
<pre role="alert">${escape(message)}</pre>
<form action="dsh-recovery://restart"><button>${escape(locale.messages.restartApplication)}</button></form>
${profileRecovery ? `<form action="dsh-recovery://plugins"><button>${escape(locale.messages.disableThirdPartyPlugins)}</button></form>
<form action="dsh-recovery://reset"><button>${escape(locale.messages.resetConfiguration)}</button></form>` : ''}
</main></html>`
}
