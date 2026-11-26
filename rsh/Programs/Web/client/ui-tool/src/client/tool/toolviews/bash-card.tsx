/** Pure expandable Bash card; callers supply the resolved workspace root. */
import { useMemo, useState, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import {
  IconApiOutline14, IconChevronDownOutline14, IconInspectOutline12, StateDot, TerminalBlock,
} from '@redspark/rsh-client-ui-primitives'
import type { TranslateNS } from '@redspark/rsh-client-ui-slots'
import type { ToolCallOwnerProps } from '../../../tool-renderer-types.ts'
import {
  isSettledPersistentShellCall,
  isSpilledShellCall,
  localizeTerminalCardModel,
  terminalBlockLabels,
  terminalCardModel,
  terminalFailed,
} from '../models/terminal-card-model.ts'
import { formatToolBody, toolRowModel, type ToolRowState } from '../models/tool-call-model.ts'
import css from './bash-sample.module.css'

/** Bash card props: the caller supplies the already-resolved workspace root and locale seat. */
export type BashCardProps = Pick<ToolCallOwnerProps, 'toolName' | 'block' | 'inspect'> & {
  /** Session workspace root used to resolve relative shell workdirs. */
  readonly cwd?: string | undefined
  /** Conversation locale seat shared by every card render site. */
  readonly t: TranslateNS<'conversation'>
}

function leadingFor(state: ToolRowState) {
  switch (state) {
    case 'error': return <StateDot state="error" />
    case 'stopped': return <StateDot state="warning" />
    // Running keeps the icon — the row sweep carries the in-flight signal.
    default: return <IconApiOutline14 size={14} />
  }
}

/** Visually hidden status — StateDot is aria-hidden; AT needs a text label. */
function stateStatus(state: ToolRowState, t: BashCardProps['t']): string | null {
  switch (state) {
    case 'running': return t('bash.running')
    case 'error': return t('bash.failed')
    case 'stopped': return t('bash.stopped')
    default: return null
  }
}

/**
 * Render expandable Bash output with an accessible lifecycle label.
 * @param props - the durable call, resolved workspace root, inspect action and locale seat.
 * @returns the Bash row with its inline terminal when expanded.
 */
export function BashCard({ toolName, block, cwd, inspect, t }: BashCardProps) {
  const model = toolRowModel(toolName, block)
  // An omitted shell workdir is the session workspace; relative values resolve against it before reaching the terminal primitive.
  const terminalModel = terminalCardModel(block, cwd)
  const terminal = terminalModel === null ? null : localizeTerminalCardModel(terminalModel, t)
  // A failing exit status is the terminal card's own error signal (the call
  // itself settles isError:false), surfaced as the row's red state dot.
  const state = model.state === 'ok' && terminalModel !== null && terminalFailed(terminalModel)
    ? 'error'
    : model.state
  const status = stateStatus(state, t)
  const [expanded, setExpanded] = useState(false)
  // Failures, persistent-shell results, and spill previews use a generic body;
  // background acknowledgements and malformed calls remain collapsed.
  const genericBody = terminal === null
    && (model.state === 'error' || isSettledPersistentShellCall(block) || isSpilledShellCall(block))
    && (model.bodyRaw !== null || model.output !== null)
  const expandable = terminal !== null || genericBody
  const open = expanded && expandable
  const body = useMemo(
    () => open && genericBody && model.bodyRaw !== null
      ? formatToolBody(model.variant, model.bodyRaw)
      : null,
    [genericBody, model.bodyRaw, model.variant, open],
  )
  const failureLine = model.state === 'error' ? model.errorSummary : null
  const toggleExpand = () => {
    setExpanded(v => !v)
  }
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!expandable || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    toggleExpand()
  }
  const leading = open
    ? <IconChevronDownOutline14 className={css.chevron} />
    : expandable
      ? (
        <>
          <span className={css.iconIdle}>{leadingFor(state)}</span>
          <IconChevronDownOutline14 className={clsx(css.chevron, css.chevronHover)} />
        </>
      )
      : leadingFor(state)
  return (
    <div className={css.card}>
      <div
        className={css.root}
        data-sample="bash"
        data-disclosure-row={expandable || undefined}
        data-variant="bash"
        data-state={state}
        data-expandable={expandable || undefined}
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        onClick={expandable ? toggleExpand : undefined}
        onKeyDown={expandable ? toggleFromKeyboard : undefined}
      >
        <span className={css.leading}>{leading}</span>
        {status !== null && <span className={css.visuallyHidden}>{status}</span>}
        <span className={css.title}>{t(model.titleKey)}</span>
        <span className={css.sep} aria-hidden />
        <span className={clsx(css.summary, failureLine !== null && css.errorSummary)}>
          {failureLine ?? terminal?.description ?? model.summary}
        </span>
      </div>
      {open && (
        <div className={css.bodyWrap}>
          {terminal !== null
            ? (
              <TerminalBlock
                {...terminal.card}
                maxLines={Infinity}
                labels={terminalBlockLabels(t)}
                className={css.terminal}
              />
            )
            : (
              <div className={css.ioCard}>
                {body !== null && (
                  <div className={css.ioSection}>
                    <span className={css.ioLabel}>{t('row.input')}</span>
                    <span className={css.ioText}>{body}</span>
                  </div>
                )}
                {body !== null && model.output !== null && (
                  <span className={css.ioDivider} aria-hidden />
                )}
                {model.output !== null && (
                  <div className={css.ioSection}>
                    <span className={css.ioLabel}>{t('row.output')}</span>
                    <span className={css.ioText} data-error={state === 'error' || undefined}>
                      {model.output}
                    </span>
                  </div>
                )}
              </div>
            )}
          {inspect !== undefined && (
            <button type="button" className={css.inspectButton} onClick={inspect}>
              <IconInspectOutline12 />
              {t('row.inspect')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
