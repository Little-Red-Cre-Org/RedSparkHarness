/**
 * Human-facing `/compact` command over the backend-independent compaction seam.
 * @module @deepseek-ai/dsh-command-compact
 */

import type { Context } from '@deepseek-ai/cordis'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type {} from '@deepseek-ai/dsh-compaction'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { COMPACT_COMMAND_DESCRIPTION, COMPACT_COMMAND_NAME, COMPACT_DEFINITION_ID, executeCompact } from './common.ts'

export const name = 'command-compact'
export const inject = ['commands', 'compaction']

/**
 * Register `/compact` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and the compaction seam.
 */
export function apply(ctx: Context): void {
  const active = new Set<Promise<CommandResult>>()
  const handler = (invocation: CommandInvocation): Promise<CommandResult> => {
    const operation = executeCompact(
      invocation,
      (signal, sourceCommandId) => ctx.compaction.compactNow(invocation.agent, signal, sourceCommandId),
    )
    active.add(operation)
    const retire = (): void => { active.delete(operation) }
    // Both branches retire without rethrowing, so the derived observer promise
    // cannot become an unhandled mirror of an expected handler rejection.
    void operation.then(retire, retire)
    return operation
  }

  ctx.effect(function* () {
    // Yield drain before registration: composite teardown is LIFO, so no new
    // invocation can enter while already-started handler promises quiesce.
    yield async () => { await Promise.allSettled(active) }
    yield ctx.commands.register({
      definitionId: CommandDefinitionId(COMPACT_DEFINITION_ID),
      name: COMPACT_COMMAND_NAME,
      description: COMPACT_COMMAND_DESCRIPTION,
      handler,
    })
  }, 'command-compact lifecycle')
}
