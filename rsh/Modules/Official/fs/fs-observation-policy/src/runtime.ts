/** RSH loader adapter for the filesystem observation-policy plugin. */

import { adaptFilesystemPlugin } from '@redspark/rsh-fs'
import { apply } from './index.ts'

/**
 * Adapt the filesystem observation policy for Loader composition.
 * @returns the adapted Cordis plugin entry.
 */
export default adaptFilesystemPlugin({
  packageName: '@redspark/rsh-fs-observation-policy',
  apiVersion: 1,
  role: 'policy',
  capability: 'filesystem',
}, {
  name: 'fs-observation-policy',
  inject: [],
  apply,
})
