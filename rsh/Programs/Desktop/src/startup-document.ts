/** Self-contained recovery document for an unavailable shell renderer or preload. */

import { formatDesktopMessage } from './locale.ts'
import type { DesktopLocale } from './locale.ts'
import type { DesktopErrorState, DesktopErrorType } from './startup-error.ts'

/**
 * Render escaped diagnostics without depending on application resource files.
 * @param locale - Shell-owned translations.
 * @param failure - Sanitized failure type, optional configuration path, and local log path.
 * @param profileRecovery - Whether the initialized application can repair its profile.
 * @returns An HTML document suitable for an isolated emergency window.
 */
export function startupFailureDocument(locale: DesktopLocale, failure: DesktopErrorState, profileRecovery = false): string {
  const escape = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
  const errorTypes: Readonly<Record<DesktopErrorType, string>> = {
    AggregateError: locale.messages.startupTypeAggregateError,
    Error: locale.messages.startupTypeError,
    RangeError: locale.messages.startupTypeRangeError,
    SyntaxError: locale.messages.startupTypeSyntaxError,
    TypeError: locale.messages.startupTypeTypeError,
    UnknownError: locale.messages.startupTypeUnknownError,
    ValidationError: locale.messages.startupTypeValidationError,
  }
  const details = [
    formatDesktopMessage(locale.messages.startupErrorType, { type: errorTypes[failure.errorType] }),
    ...failure.path === undefined ? [] : [formatDesktopMessage(locale.messages.startupErrorPath, { path: failure.path })],
    ...failure.rule === undefined ? [] : [formatDesktopMessage(locale.messages.startupErrorRule, { rule: failure.rule })],
    failure.logPath === undefined ? locale.messages.startupErrorLogAdvice
      : formatDesktopMessage(locale.messages.startupErrorLogWritten, { path: failure.logPath }),
  ].join('\n')
  return `<!doctype html><html lang="${locale.id}"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action dsh-recovery:">
<title>${escape(locale.messages.startupFailed)}</title>
<style>:root{color-scheme:light dark;font-family:system-ui}body{max-width:720px;margin:10vh auto;padding:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}.window-drag{position:fixed;top:0;left:0;right:148px;height:40px;-webkit-app-region:drag}</style>
<div class="window-drag" aria-hidden="true"></div>
<main><h1>${escape(locale.messages.startupFailed)}</h1><p>${escape(locale.messages.startupReinstallAdvice)}</p>
${profileRecovery ? `<p>${escape(locale.messages.startupConfigurationAdvice)}</p>` : ''}
<pre role="alert">${escape(details)}</pre>
<form action="dsh-recovery://restart"><button>${escape(locale.messages.restartApplication)}</button></form>
${profileRecovery ? `<form action="dsh-recovery://plugins"><button>${escape(locale.messages.disableThirdPartyPlugins)}</button></form>
<form action="dsh-recovery://reset"><button>${escape(locale.messages.resetConfiguration)}</button></form>` : ''}
</main></html>`
}
