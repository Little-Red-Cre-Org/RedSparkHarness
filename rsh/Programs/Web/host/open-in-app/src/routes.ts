/**
 * The three open-in-app route handlers, free of any route carrier.
 *
 * Both compositions serve the same catalog, icons, and launch endpoint: the
 * browser build registers these handlers on the Cordis `webServer`, and a
 * Native build registers them on the Native listener's `httpRoutes`. Keeping
 * the handlers here is what stops the two hosts from drifting — the security
 * fence, the wire validation, and the lazy resolution have exactly one home.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute } from 'node:path'
import { stat } from 'node:fs/promises'
import { OPEN_IN_APP_CATALOG, type OpenInAppApp } from './catalog.ts'
import {
  launchResolved, resolveLaunch, resolveOpenInAppApps,
  type OpenInAppInternals, type OpenInAppResolvedLaunch,
} from './resolver.ts'
import { extractAppIcon, type OpenInAppIcon } from './icons.ts'
import { OPEN_IN_APP_APPS_ROUTE, OPEN_IN_APP_ICON_PREFIX, OPEN_IN_APP_OPEN_ROUTE } from './shared.ts'

/** Per-route deadlines and the launch watch window, as configured by the host row. */
export interface OpenInAppRouteConfig {
  readonly probeTimeoutMs: number
  readonly iconTimeoutMs: number
  readonly launchWatchMs: number
}

/** Trust fence shared by both listeners: a rejection status, or undefined to admit. */
export interface OpenInAppRejection {
  /** @param request - the inbound request, read for its headers only.
   * @returns 401 or 403 when the composition refuses the caller. */
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/** Open-route request bodies are tiny JSON objects; anything larger is hostile. */
const MAX_BODY_BYTES = 64 * 1024

/** JSON response (no-store: availability and launch outcomes are live facts). */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** 405 with the route's one supported method. */
function sendMethodNotAllowed(res: ServerResponse, allow: 'GET' | 'POST'): void {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.end()
}

/** Collect a bounded request body as UTF-8 text; null past the ceiling (stream drained). */
async function readBoundedBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  // http server streams without setEncoding always yield Buffer chunks.
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      // Drain the remainder so the refusal is a readable response, not a socket cut.
      req.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

/** Validate one open-route body at the wire: JSON object with string app/path. */
function parseOpenBody(text: string): { app: string; path: string } | null {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    // Swallows the parse error: a non-JSON body is exactly the null case.
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  const { app, path } = body as { app?: unknown; path?: unknown }
  return typeof app === 'string' && typeof path === 'string' ? { app, path } : null
}

/** One handler per route, all sharing a single resolution and icon cache. */
export interface OpenInAppRoutes {
  /** GET the resolved application ids. */
  readonly apps: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  /** GET one application's bundle icon by id. */
  readonly icon: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  /** POST one launch request. */
  readonly open: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  /** Route paths, so a listener registers exactly these. */
  readonly paths: {
    readonly apps: typeof OPEN_IN_APP_APPS_ROUTE
    readonly icon: typeof OPEN_IN_APP_ICON_PREFIX
    readonly open: typeof OPEN_IN_APP_OPEN_ROUTE
  }
}

/**
 * Build the three handlers over one catalog resolution and one icon cache.
 *
 * Resolution is lazy and once-per-life: the apps route serves its keys and the
 * open route launches its values, so a click, menu open, or page reload never
 * re-runs detection. A launch that finds its executable gone (`ENOENT`)
 * invalidates that one entry and re-resolves it once.
 * @param config - per-route deadlines and the launch watch window.
 * @param trust - the composition's request fence.
 * @param internals - PATH resolver and test-seam facts.
 * @returns the three handlers and the paths they serve.
 */
export function createOpenInAppRoutes(
  config: OpenInAppRouteConfig,
  trust: OpenInAppRejection,
  internals: () => OpenInAppInternals,
): OpenInAppRoutes {
  /** Lazy once-per-life resolution; the map is the mutable authority. */
  let resolutions: Promise<Map<string, OpenInAppResolvedLaunch>> | undefined
  const availability = (): Promise<Map<string, OpenInAppResolvedLaunch>> =>
    resolutions ??= resolveOpenInAppApps(config.probeTimeoutMs, internals())
  /** Per-app icon promise cache (null = resolved as unavailable). */
  const icons = new Map<string, Promise<OpenInAppIcon | null>>()
  const iconOf = (app: OpenInAppApp, resolved: OpenInAppResolvedLaunch): Promise<OpenInAppIcon | null> => {
    let cached = icons.get(app.id)
    if (cached === undefined) {
      cached = extractAppIcon(app, resolved, config.iconTimeoutMs, internals())
      icons.set(app.id, cached)
    }
    return cached
  }
  /**
   * Replace one stale resolution after a missing-executable launch: the
   * entry (and its icon) re-resolves once; an entry that no longer resolves
   * leaves the map and the next apps read no longer offers it.
   * @param app - the catalog entry whose launcher disappeared.
   * @returns the fresh launcher, or undefined when it no longer resolves.
   */
  const refreshResolution = async (app: OpenInAppApp): Promise<OpenInAppResolvedLaunch | undefined> => {
    const map = await availability()
    const fresh = await resolveLaunch(app, config.probeTimeoutMs, internals())
    icons.delete(app.id)
    if (fresh === null) {
      map.delete(app.id)
      return undefined
    }
    map.set(app.id, fresh)
    return fresh
  }
  /** Answer an untrusted/unauthenticated request; true when it was rejected.
   * @param req - inbound request.
   * @param res - response whose status the rejection sets.
   * @returns whether the request was refused.
   */
  const rejected = (req: IncomingMessage, res: ServerResponse): boolean => {
    const rejection = trust.requestRejection(req)
    if (rejection === undefined) return false
    res.statusCode = rejection
    res.end()
    return true
  }

  return {
    paths: {
      apps: OPEN_IN_APP_APPS_ROUTE,
      icon: OPEN_IN_APP_ICON_PREFIX,
      open: OPEN_IN_APP_OPEN_ROUTE,
    },
    async apps(req, res) {
      if (rejected(req, res)) return
      if (req.method !== 'GET') {
        sendMethodNotAllowed(res, 'GET')
        return
      }
      sendJson(res, 200, { apps: [...(await availability()).keys()] })
    },
    async icon(req, res) {
      if (rejected(req, res)) return
      if (req.method !== 'GET') {
        sendMethodNotAllowed(res, 'GET')
        return
      }
      // Node always sets url on server requests; String keeps that fact local.
      const pathname = new URL(String(req.url), 'http://localhost').pathname
      const id = pathname.slice(OPEN_IN_APP_ICON_PREFIX.length).replace(/^\//, '')
      const noIcon = (): void => { sendJson(res, 404, { code: 'not-found', message: `no icon for ${id}` }) }
      const app = OPEN_IN_APP_CATALOG.find(entry => entry.id === id)
      if (app === undefined) {
        noIcon()
        return
      }
      const resolved = (await availability()).get(app.id)
      if (resolved === undefined) {
        noIcon()
        return
      }
      const icon = await iconOf(app, resolved)
      if (icon === null) {
        noIcon()
        return
      }
      res.statusCode = 200
      res.setHeader('content-type', icon.contentType)
      res.setHeader('cache-control', 'public, max-age=3600')
      res.end(icon.bytes)
    },
    async open(req, res) {
      if (rejected(req, res)) return
      if (req.method !== 'POST') {
        sendMethodNotAllowed(res, 'POST')
        return
      }
      // Body-format validation: the essence must be exactly application/json.
      // String(undefined) is 'undefined', which never matches.
      const essence = String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase()
      if (essence !== 'application/json') {
        sendJson(res, 415, { code: 'unsupported-media-type', message: 'content-type must be application/json' })
        return
      }
      let text: string | null
      try {
        text = await readBoundedBody(req)
      } catch {
        // Swallows connection errors mid-body: there is nothing left to answer precisely.
        sendJson(res, 400, { code: 'bad-request', message: 'request body unreadable' })
        return
      }
      if (text === null) {
        sendJson(res, 413, { code: 'payload-too-large', message: 'request body is too large' })
        return
      }
      const parsed = parseOpenBody(text)
      if (parsed === null) {
        sendJson(res, 400, { code: 'bad-request', message: 'request body must be JSON with string "app" and "path"' })
        return
      }
      const app = OPEN_IN_APP_CATALOG.find(entry => entry.id === parsed.app)
      const resolved = app === undefined ? undefined : (await availability()).get(app.id)
      if (app === undefined || resolved === undefined) {
        sendJson(res, 400, { code: 'bad-request', message: `unknown or unavailable app: ${parsed.app}` })
        return
      }
      if (parsed.path === '' || !isAbsolute(parsed.path)) {
        sendJson(res, 400, { code: 'bad-request', message: 'path must be an absolute directory path' })
        return
      }
      let directory: boolean
      try {
        directory = (await stat(parsed.path)).isDirectory()
      } catch {
        // Swallows ENOENT/EACCES: both mean there is no directory to open.
        directory = false
      }
      if (!directory) {
        sendJson(res, 404, { code: 'not-found', message: `directory does not exist: ${parsed.path}` })
        return
      }
      let outcome = await launchResolved(resolved, parsed.path, config.launchWatchMs, internals())
      if (outcome === 'missing') {
        // The verified launcher is gone (uninstalled since resolution):
        // refresh this one entry and retry once with the fresh launcher.
        const fresh = await refreshResolution(app)
        outcome = fresh === undefined
          ? 'failed'
          : await launchResolved(fresh, parsed.path, config.launchWatchMs, internals())
      }
      if (outcome === 'launched') {
        sendJson(res, 200, { ok: true })
      } else {
        sendJson(res, 502, { code: 'launch-failed', message: `failed to launch ${app.id}` })
      }
    },
  }
}
