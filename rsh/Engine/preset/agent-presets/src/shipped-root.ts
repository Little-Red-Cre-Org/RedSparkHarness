/** Package-root asset resolution shared by the discovery and storage faces. */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The shipped presets, resolved from the package manifest rather than this
 * module: the source tree and every emitted directory sit at different depths.
 */
export const SHIPPED_PRESET_ROOT = join(
  dirname(fileURLToPath(import.meta.resolve('@redspark/rsh-agent-presets/package.json'))),
  'presets',
)
