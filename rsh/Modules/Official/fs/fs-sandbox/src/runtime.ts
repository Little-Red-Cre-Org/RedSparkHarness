/** RSH loader adapter for the sandbox-enforcing filesystem Provider. */

import { adaptFilesystemPlugin } from '@redspark/rsh-fs'
import SandboxedFileSystem from './index.ts'

/**
 * Adapt the sandbox filesystem Provider for Loader composition.
 * @returns the adapted Cordis plugin entry.
 */
export default adaptFilesystemPlugin({
  packageName: '@redspark/rsh-fs-sandbox',
  apiVersion: 1,
  role: 'provider',
  capability: 'filesystem',
}, SandboxedFileSystem)
