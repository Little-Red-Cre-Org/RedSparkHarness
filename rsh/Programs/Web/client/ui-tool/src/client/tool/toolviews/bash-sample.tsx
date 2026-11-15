/** Cordis registration and Session-workspace bindings for the pure Bash card. */
import type { Context } from '@redspark/cordis'
import type { PropsLocale } from '@redspark/rsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { CONVERSATION_NS as NS } from '../../locale.ts'
import { BashCard } from './bash-card.tsx'

type BashRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/** Resolve the Cordis Session workspace, then render the pure Bash card. */
export function BashRow(props: BashRowProps) {
  const cwd = props.useSessions(list => list.byId[props.sessionId]?.cwd)
  return <BashCard {...props} cwd={cwd} />
}

/** Registers the standalone Bash conversation-row sample. */
export const bashToolviewSample = {
  name: 'bash-toolview-sample',
  inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({ name: 'tool.call.toolview', key: 'bash', locale: NS }, BashRow))
  },
}
