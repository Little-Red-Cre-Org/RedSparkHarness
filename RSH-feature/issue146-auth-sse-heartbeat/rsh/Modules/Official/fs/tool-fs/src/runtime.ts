/** RSH loader adapter for the model-facing filesystem tool Consumer. */

import { adaptFilesystemPlugin } from '@deepseek-ai/dsh-fs'
import { apply, Config, inject, name } from './index.ts'

/**
 * Adapt the filesystem tool Consumer for Loader composition.
 * @returns the adapted Cordis plugin entry.
 */
export default adaptFilesystemPlugin({
  packageName: '@deepseek-ai/dsh-tool-fs',
  apiVersion: 1,
  role: 'consumer',
  capability: 'filesystem',
}, {
  name,
  Config,
  inject,
  apply,
})
