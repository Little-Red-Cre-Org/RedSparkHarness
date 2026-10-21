/** Parser for package-authored legacy dsh.client declarations. */
import type { DshClientManifest } from '@deepseek-ai/dsh-package-manifest'
import { optionalStringArray } from './manifest.ts'

/**
 * Narrow an unknown parsed JSON value to the `dsh.client` declaration.
 * @param pkgName - package name used as the diagnostic prefix.
 * @param value - the raw `dsh.client` field of the package manifest.
 * @returns the validated declaration, or undefined when the field is absent.
 * @throws {Error} when the field is present but any member is malformed.
 */
export function parseDshClient(pkgName: string, value: unknown): DshClientManifest | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) {
    throw new Error(`client-modules: ${pkgName} has a non-object dsh.client declaration`)
  }
  const decl = value as Record<string, unknown>
  if (typeof decl.platform !== 'string') {
    throw new Error(`client-modules: ${pkgName} dsh.client.platform must be a string`)
  }
  const inject = optionalStringArray(pkgName, 'dsh.client.inject', decl.inject)
  const external = optionalStringArray(pkgName, 'dsh.client.external', decl.external)
  if (decl.immediately !== undefined && typeof decl.immediately !== 'boolean') {
    throw new Error(`client-modules: ${pkgName} dsh.client.immediately must be a boolean`)
  }
  return {
    platform: decl.platform,
    ...(inject !== undefined ? { inject } : {}),
    ...(external !== undefined ? { external } : {}),
    ...(decl.immediately !== undefined ? { immediately: decl.immediately } : {}),
  }
}
