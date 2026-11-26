/** Native presentation of one slash-command lifecycle (`command/run` → `command/done`). */
import { useState, type ReactNode } from 'react'
import { DisclosureRow, IconApiOutline14, StateDot } from '@redspark/rsh-client-ui-primitives'
import type { TranslateNS } from '@redspark/rsh-client-ui-slots'
import type { SessionEvent } from '@redspark/rsh-session/types'
import css from './command-row.module.css'
import a11yCss from './conversation.module.css'

type Translate = TranslateNS<'nativeApplication'>

/** One command execution as the transcript renders it. */
export interface NativeCommandRecord {
  /** Seq of the run event; the done event's seq when only the done is in the window. */
  readonly seq: number
  /** Command name; null when the run fell outside the loaded window. */
  readonly name: string | null
  /** Settlement; null while the command is still executing. */
  readonly outcome: { readonly kind: 'success' | 'error'; readonly text?: string } | null
}

type CommandState = 'running' | 'ok' | 'error'

function stateOf(outcome: NativeCommandRecord['outcome']): CommandState {
  if (outcome === null) return 'running'
  return outcome.kind === 'error' ? 'error' : 'ok'
}

function leadingFor(state: CommandState): ReactNode {
  return state === 'error' ? <StateDot state="error" /> : <IconApiOutline14 size={14} />
}

/**
 * Pair the log-only command lifecycle by `commandId`, mirroring the browser
 * lane's `CommandNode`: a run anchors the row at its own seq, a done without an
 * in-window run anchors at its own seq with no name, and a run without a done
 * stays executing.
 * @param events - accepted live or restored Session events in seq order.
 * @returns command records indexed by the seq that renders them (paired dones
 *  are folded into their run and claim no row).
 */
export function foldNativeCommands(events: readonly SessionEvent[]): ReadonlyMap<number, NativeCommandRecord> {
  const started = new Map<string, number>()
  const records = new Map<number, NativeCommandRecord>()
  for (const event of events) {
    if (event.type === 'command/run') {
      started.set(event.data.commandId, event.seq)
      records.set(event.seq, { seq: event.seq, name: event.data.name, outcome: null })
      continue
    }
    if (event.type !== 'command/done') continue
    const anchor = started.get(event.data.commandId)
    const outcome = {
      kind: event.data.kind,
      ...event.data.text === undefined ? {} : { text: event.data.text },
    }
    if (anchor === undefined) {
      records.set(event.seq, { seq: event.seq, name: null, outcome })
      continue
    }
    const settled = records.get(anchor)
    if (settled !== undefined) records.set(anchor, { ...settled, outcome })
  }
  return records
}

/** One command row: the command name, its settlement summary, and the full output when multi-line. */
export function NativeCommandRow({ record, t }: { record: NativeCommandRecord; t: Translate }) {
  const [expanded, setExpanded] = useState(false)
  const text = record.outcome?.text
  const summary = record.outcome === null
    ? t('commandRunning')
    : text ?? (record.outcome.kind === 'error' ? t('commandFailed') : t('commandDone'))
  const title = record.name ?? t('commandTitle')
  const state = stateOf(record.outcome)
  const body = text !== undefined && text.includes('\n') ? text : null
  return (
    <div className={css.root} data-state={state} data-command-row="">
      {state === 'running' && <span className={a11yCss.visuallyHidden}>{t('rowRunning')}</span>}
      {state === 'error' && <span className={a11yCss.visuallyHidden}>{t('rowFailed')}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={leadingFor(state)}
        title={title}
        open={expanded && body !== null}
        expandable={body !== null}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span className={css.summary} data-error={state === 'error' || undefined}>{summary}</span>
          </>
        )}
      >
        <pre className={css.body} data-error={state === 'error' || undefined}>{body}</pre>
      </DisclosureRow>
    </div>
  )
}
