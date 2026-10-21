/** Cordis Desktop assembly loaded only for a legacy profile. */
import { existsSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { boot, composeEntries, loadLayeredEnv, loadProfileDirectory, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-api-gateway'
import type { ConnectionFetchHandler } from '@deepseek-ai/dsh-client-connection'
import { createDesktopAssetHandler, DESKTOP_STREAM_PATH } from './web-assets.ts'
import type { DesktopHostRuntime } from './runtime.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const DESKTOP_PATCH = fileURLToPath(new URL('../config/desktop.cordis.patch.yml', import.meta.url))
const ROOT_CONFIG = '# Electron desktop composition root; package transactions own this file.\n[]\n'
const ROOT_CONFIG_FILENAME = 'desktop.cordis.yml'

function packageManifestPath(projectDir: string, packageName: string): string {
  const path = join(projectDir, 'node_modules', ...packageName.split('/'), 'package.json')
  if (!existsSync(path)) throw new Error(`dsh desktop: installed package ${JSON.stringify(packageName)} has no manifest`)
  return path
}

function isProjectPath(projectDir: string, target: string): boolean {
  const root = realpathSync(projectDir)
  const path = realpathSync(target)
  return path === root || path.startsWith(root + sep)
}

function desktopPatches(runtimeDir: string, projectDir: string, allowLinkedPackages: boolean): PatchOptions[] {
  const dshRoot = dirname(packageManifestPath(runtimeDir, '@deepseek-ai/dsh'))
  const profile = loadProfileDirectory('dsh desktop', projectDir, join(dshRoot, 'package.json'))
  for (const layer of profile.layers) {
    if (!allowLinkedPackages && !isProjectPath(projectDir, layer.packageDir) && !isProjectPath(runtimeDir, layer.packageDir)) {
      throw new Error(`dsh desktop: profile bundle ${JSON.stringify(layer.packageName)} resolved outside the Desktop runtime and profile`)
    }
  }
  const layers = [
    ...profile.layers.map(layer => layer.patches),
    profile.patches,
    loadOverlayPatches('dsh desktop', DESKTOP_PATCH),
  ]
  const rows = new Map(composeEntries(layers).flatMap(row => typeof row.id === 'string' ? [[row.id, row] as const] : []))
  const agentPresets = rows.get('agent-presets')
  if (agentPresets !== undefined) {
    layers.push([{
      id: 'agent-presets',
      config: {
        ...(agentPresets.config ?? {}) as Record<string, unknown>,
        roots: [{ path: join(dshRoot, 'config', 'agent-presets'), trust: 'system' }],
      },
    }])
  }
  return layers.flat()
}

function remoteStreamHandler(ctx: Context): ConnectionFetchHandler {
  return {
    requestBodyMode: () => 'buffered',
    async fetch(request): Promise<Response> {
      if (request.method !== 'POST') return new Response(null, { status: 405 })
      const gateway = ctx.get('typertGateway')
      if (gateway === undefined) return new Response('gateway unavailable', { status: 503 })
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }
      if (!isRecord(body) || typeof body.endpoint !== 'string') {
        return new Response('invalid stream request', { status: 400 })
      }
      const abort = new AbortController()
      const cancel = (): void => { abort.abort(request.signal.reason) }
      request.signal.addEventListener('abort', cancel, { once: true })
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            const values = await gateway.wireStream.open(body.endpoint as string, body.payload, abort.signal)
            for await (const value of values) {
              controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
            }
            controller.close()
          } catch (error) {
            controller.error(error)
          } finally {
            request.signal.removeEventListener('abort', cancel)
          }
        },
        cancel(reason) {
          abort.abort(reason)
          request.signal.removeEventListener('abort', cancel)
        },
      })
      return new Response(stream, { headers: { 'content-type': 'application/x-ndjson' } })
    },
  }
}


/**
 * Activate only the legacy Desktop composition.
 * @param runtimeDir - installed immutable runtime.
 * @param projectDir - installed profile directory.
 * @param allowLinkedPackages - development-only linked bundle allowance.
 * @returns shared private-carrier handlers and their teardown.
 * @throws if the profile selects native Client entries without selecting the native Host runtime.
 */
export async function createLegacyDesktopRuntime(
  runtimeDir: string, projectDir: string, allowLinkedPackages: boolean,
): Promise<DesktopHostRuntime> {
  if (existsSync(join(projectDir, 'rsh.client.json'))) {
    throw new Error('dsh desktop: rsh.client.json requires profile runtime "native"')
  }
  const rootConfig = join(projectDir, ROOT_CONFIG_FILENAME)
  writeFileSync(rootConfig, ROOT_CONFIG)
  const environment = loadLayeredEnv('dsh desktop')
  let current: Context | undefined
  const ctx = await boot('dsh desktop', rootConfig, structuredClone(desktopPatches(
    runtimeDir,
    projectDir,
    allowLinkedPackages,
  )), (hostCtx) => {
    current = hostCtx
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
    provideCmdline(hostCtx, { args: [], exit: () => {} })
  })
  const connection = ctx.get('connection')
  const clientModules = ctx.get('clientModules')
  const gateway = ctx.get('typertGateway')
  if (connection === undefined || clientModules === undefined || gateway === undefined) {
    await ctx.fiber.dispose()
    throw new Error('dsh desktop: composition did not provide connection, typertGateway, and clientModules')
  }
  const api = connection.createSharedFetchHandler('/api')
  const assets = createDesktopAssetHandler(ctx, runtimeDir)
  const streams = remoteStreamHandler(ctx)

  return {
    fetch: (request) => {
      const path = new URL(request.url).pathname
      return path === DESKTOP_STREAM_PATH ? streams.fetch(request)
        : path.startsWith('/api/') ? api.fetch(request) : assets.fetch(request)
    },
    dispose: async () => { await current?.fiber.dispose(); current = undefined },
  }
}
