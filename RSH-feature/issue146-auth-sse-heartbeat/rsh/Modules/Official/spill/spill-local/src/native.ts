/** Native spill Provider reusing private file writes and the existing startup cleanup policy. */
import { resolve } from 'node:path'
import { z } from 'zod'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { SpillLocator, type SpillOperations } from '@deepseek-ai/dsh-spill/native'
import { gatherSweepRoots, sweepSpillRoots } from './cleanup.ts'
import { privateRoot, saveTextFile } from './store.ts'

/** Local storage is owned until every admitted file write and startup sweep has settled. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-spill-local', targets: ['host'], requires: [], provides: ['spillStore'],
  resolve(input) {
    const config = z.object({ root: z.string().min(1).optional(),
      cleanupPeriodDays: z.number().int().nonnegative().default(30) }).strict().parse(input ?? {})
    return (context) => {
      const root = config.root === undefined ? privateRoot() : resolve(config.root)
      const pending = new Set<Promise<unknown>>()
      let closed = false
      const track = <T>(operation: Promise<T>): Promise<T> => {
        pending.add(operation)
        void operation.then(() => pending.delete(operation), () => pending.delete(operation))
        return operation
      }
      context.own(async () => { closed = true; await Promise.allSettled([...pending]) })
      if (config.cleanupPeriodDays > 0) {
        const warn = (message: string): void => { console.warn(message) }
        const cutoffMs = Date.now() - config.cleanupPeriodDays * 86_400_000
        void track(gatherSweepRoots(root, warn).then(roots => sweepSpillRoots({ roots, cutoffMs, warn })))
      }
      const store: SpillOperations = {
        saveText(input, signal) {
          if (closed) throw new Error('spill-local: Provider is closed')
          const cancellation = AbortSignal.any([signal, context.signal])
          cancellation.throwIfAborted()
          return track((async () => {
            const saved = await saveTextFile({ root, sessionId: input.owner.sessionId,
              suggestedName: input.suggestedName, content: input.content })
            cancellation.throwIfAborted()
            return { locator: SpillLocator(saved.path), bytes: saved.bytes,
              retrievalHint: 'Use read with offset/limit, or grep this path to search within it.' }
          })())
        },
      }
      context.provide('spillStore', store)
    }
  },
}
