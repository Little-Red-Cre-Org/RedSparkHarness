/** RSH loader adapter for the filesystem service Definition. */

import { adaptCordisPlugin } from '@redspark/rsh-plugin-host'
import { FileSystem } from './index.ts'

/**
 * Adapt the filesystem Definition for Loader composition.
 * @returns the adapted Cordis plugin entry.
 */
export default adaptCordisPlugin({
  packageName: '@redspark/rsh-fs',
  apiVersion: 1,
  role: 'definition',
  capability: 'filesystem',
}, FileSystem)
