/** RSH loader adapter for the model-facing filesystem tool Consumer. */

import { adaptFilesystemPlugin } from '@redspark/rsh-fs'
import { apply, Config, inject, name } from './index.ts'

/**
 * Adapt the filesystem tool Consumer for Loader composition.
 * @returns the adapted Cordis plugin entry.
 */
export default adaptFilesystemPlugin({
  packageName: '@redspark/rsh-tool-fs',
  apiVersion: 1,
  role: 'consumer',
  capability: 'filesystem',
}, {
  name,
  Config,
  inject,
  apply,
})
