/** Exact package releases and adapter declarations supported by this Host composition. */
export const SUPPORT_RECORD = {
  '@deepseek-ai/cordis': { version: '4.0.2', api: 'cordis-plugin-host' },
  '@deepseek-ai/cordis-plugin-loader': { version: '1.0.3', api: 'cordis-entry-tree' },
  '@deepseek-ai/dsh-fs-local': { version: '0.1.5-rc.2', apiVersion: 1, role: 'provider', capability: 'filesystem' },
  '@deepseek-ai/dsh-fs-observation-policy': { version: '0.1.5-rc.2', apiVersion: 1, role: 'policy', capability: 'filesystem' },
  '@deepseek-ai/dsh-fs-sandbox': { version: '0.1.5-rc.2', apiVersion: 1, role: 'provider', capability: 'filesystem' },
  '@deepseek-ai/dsh-tool-fs': { version: '0.1.5-rc.2', apiVersion: 1, role: 'consumer', capability: 'filesystem' },
  // These packages expose Cordis plugins, not dsh.runtime metadata. The role and
  // capability below describe the RSH adapter descriptor passed to plugin-host.
  '@deepseek-ai/dsh-system-prompt': {
    version: '0.1.5-rc.2', api: 'cordis-plugin', role: 'adapter', capability: 'dsh-compatibility', service: 'systemPrompt',
  },
  '@deepseek-ai/dsh-tools': {
    version: '0.1.5-rc.2', api: 'cordis-plugin', role: 'adapter', capability: 'dsh-compatibility', service: 'tools',
  },
} as const

/** Installed package fields consumed by the compatibility support check. */
export interface CompatPackageManifest {
  readonly name?: unknown
  readonly version?: unknown
  readonly dsh?: { readonly runtime?: { readonly apiVersion?: unknown; readonly role?: unknown; readonly capability?: unknown } }
}

/** Validate an installed Cordis package against the supported package record.
 * @param packageName - installed npm package name.
 * @param manifest - installed package manifest read from the package itself.
 */
export function validateSupportManifest(packageName: string, manifest: CompatPackageManifest): void {
  if (!Object.prototype.hasOwnProperty.call(SUPPORT_RECORD, packageName)) {
    throw new Error(`compat-dsh-runtime: unsupported package ${packageName}`)
  }
  const support = SUPPORT_RECORD[packageName as keyof typeof SUPPORT_RECORD]
  if (manifest.name !== packageName) {
    throw new Error(`compat-dsh-runtime: unsupported ${packageName} package name ${String(manifest.name)}`)
  }
  if (manifest.version !== support.version) {
    throw new Error(`compat-dsh-runtime: unsupported ${packageName} version ${String(manifest.version)}`)
  }
  if ('apiVersion' in support) {
    const runtime = manifest.dsh?.runtime
    if (runtime?.apiVersion !== support.apiVersion || runtime.role !== support.role || runtime.capability !== support.capability) {
      throw new Error(`compat-dsh-runtime: unsupported ${packageName} runtime declaration`)
    }
  }
}
