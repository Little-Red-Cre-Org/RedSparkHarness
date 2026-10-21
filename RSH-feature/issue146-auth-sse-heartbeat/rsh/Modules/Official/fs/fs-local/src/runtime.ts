/** RSH loader adapter for the local filesystem Provider. */

import { adaptFilesystemPlugin } from '@deepseek-ai/dsh-fs'
import LocalFileSystem from './index.ts'

/**
 * Adapt the local filesystem Provider for Loader composition.
 * @returns the adapted Cordis plugin entry.
 */
export default adaptFilesystemPlugin({
  packageName: '@deepseek-ai/dsh-fs-local',
  apiVersion: 1,
  role: 'provider',
  capability: 'filesystem',
}, LocalFileSystem)
