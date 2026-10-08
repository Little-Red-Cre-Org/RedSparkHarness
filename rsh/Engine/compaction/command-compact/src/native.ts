/**
 * Native `/compact` human command over the selected native compaction Provider.
 * The command runs inside the Program's idle Session operation, so the
 * Provider writes through the invocation's exact active owner.
 * @module @deepseek-ai/dsh-command-compact/native
 */

import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/native'
import type {} from '@deepseek-ai/dsh-compaction/native'
import { COMPACT_COMMAND_DESCRIPTION, COMPACT_COMMAND_NAME, COMPACT_DEFINITION_ID, executeCompact } from './common.ts'

/** Register `/compact` with the selected native command service. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-command-compact', targets: ['host'], requires: ['commands', 'compaction'],
  provides: [],
  resolve(input) {
    if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 0)) {
      throw new Error('command-compact: configuration must be an empty object')
    }
    return (context) => {
      const compaction = context.require('compaction')
      context.effect(context.require('commands').register({
        definitionId: CommandDefinitionId(COMPACT_DEFINITION_ID),
        name: COMPACT_COMMAND_NAME,
        description: COMPACT_COMMAND_DESCRIPTION,
        handler: invocation => executeCompact(invocation,
          (signal, sourceCommandId) => compaction.compactNow(invocation.owner, signal, sourceCommandId)),
      }, context.scope))
    }
  },
}
