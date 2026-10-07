/** Standalone local child connection owner for clients that do not mount NativeHost. */

import type { ChildConnectionDefinition } from '@deepseek-ai/dsh-subprocess/native'
import { LocalSubprocessController } from './controller.ts'

/** Local child-connection capability plus its owned process-manager lifetime. */
export interface LocalChildConnectionProvider extends ChildConnectionDefinition {
  /** Terminate and await any remaining child ranges, then release the host-exit hook. */
  dispose(): Promise<void>
}

/**
 * Create the same managed local process owner used by the Native Provider.
 * @returns a framework-free connection capability with explicit teardown.
 */
export function createLocalChildConnectionProvider(): LocalChildConnectionProvider {
  const controller = new LocalSubprocessController((message) => { process.emitWarning(message) })
  return {
    connect: spec => controller.connect(spec),
    dispose: () => controller.dispose(),
  }
}
