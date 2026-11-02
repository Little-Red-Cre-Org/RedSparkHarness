/** RSH loader adapter for the local filesystem Provider. */

import { adaptFilesystemPlugin } from '@redspark/rsh-fs'
import LocalFileSystem from './index.ts'

/**
 * Adapt the local filesystem Provider for Loader composition.
 * @returns the adapted Cordis plugin entry.
 */
export default adaptFilesystemPlugin({
  packageName: '@redspark/rsh-fs-local',
  apiVersion: 1,
  role: 'provider',
  capability: 'filesystem',
}, LocalFileSystem)
