/** Resolve the selected Host graph in an isolated module cache without activating Providers. */
import { parentPort, workerData } from 'node:worker_threads'
import { createLaunchEnvironmentSnapshot, launchEnvironmentProvider } from '@deepseek-ai/dsh-launch-environment/native'
import { NativeScope, resolveInstallation, validateNativePluginEntry, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { pathToFileURL } from 'node:url'
import type { NativeDesktopValidationDiagnostic } from './native-module-management.ts'
import type { NativeHostPreflightInput, NativeHostPreflightReply } from './native-host-preflight-types.ts'

const port = parentPort
if (port === null) throw new Error('desktop native Host preflight requires a worker parent')

void validate().then(
  () => { port.postMessage({ valid: true } satisfies NativeHostPreflightReply) },
  (reason: unknown) => {
    const diagnostic = validationDiagnostic(reason)
    port.postMessage({
      valid: false,
      ...diagnostic === undefined ? {} : { diagnostic },
    } satisfies NativeHostPreflightReply)
  },
)

/** Project the first structured validation issue without reading its message or other fields. */
function validationDiagnostic(reason: unknown): NativeDesktopValidationDiagnostic | undefined {
  if (!(reason instanceof Error) || !('issues' in reason) || !Array.isArray(reason.issues)) return undefined
  const issue: unknown = reason.issues[0]
  if (typeof issue !== 'object' || issue === null || !('path' in issue) || !('rule' in issue)) return undefined
  const path = issue.path
  const rule = issue.rule
  if (!Array.isArray(path) || typeof rule !== 'string'
    || !path.every((part: unknown): part is string | number => typeof part === 'string' || typeof part === 'number')) {
    return undefined
  }
  return { path: path.join('.'), rule }
}

async function validate(): Promise<void> {
  const input = workerData as NativeHostPreflightInput
  const declarations = new Map(input.scopes.map(row => [row.id, row]))
  const scopes = new Map<string, NativeScope>()
  const scopeFor = (id: string): NativeScope => {
    const existing = scopes.get(id)
    if (existing !== undefined) return existing
    const row = declarations.get(id)
    if (row === undefined) throw new Error('native profile has an unknown scope')
    const scope = new NativeScope(row.parent === undefined ? undefined : scopeFor(row.parent))
    scopes.set(id, scope)
    return scope
  }
  const requests = await Promise.all(input.installations.map(async (row) => {
    const imported = await import(pathToFileURL(row.entryPath).href) as { readonly plugin?: unknown }
    return {
      plugin: validateNativePluginEntry(imported.plugin, row.entry),
      scope: scopeFor(row.scope),
      config: row.config,
    }
  }))
  for (const row of input.providers) {
    const { scope: scopeId, ...metadata } = row
    requests.push({
      plugin: { ...metadata, resolve: () => () => {} } as NativePlugin,
      scope: scopeFor(scopeId),
      config: undefined,
    })
  }
  for (const row of input.scopes) {
    if (row.parent === undefined) requests.push({
      plugin: launchEnvironmentProvider(createLaunchEnvironmentSnapshot([])),
      scope: scopeFor(row.id),
      config: undefined,
    })
  }
  const carrier = { ...input.carrier, resolve: (config: unknown) => {
    if (config !== undefined) throw new Error('desktop carrier takes no profile configuration')
    return () => {}
  } } as unknown as NativePlugin
  requests.push({
    plugin: carrier,
    scope: scopeFor(input.carrierScope),
    config: undefined,
  })
  resolveInstallation(requests, 'host')
}
