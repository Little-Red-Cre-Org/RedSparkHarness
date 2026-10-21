import { useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import {
  Button, IconCheckOutline14, IconChevronDownOutline14, IconChevronLeftOutline14,
  IconChevronRightOutline14, IconChevronUpOutline14, IconCloseOutline16,
  IconEditOutline16, MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  QuestionAnswer, QuestionDraftAnswer, QuestionDraftProgress, QuestionPresentation,
} from './question-presentation.ts'
import css from './client/QuestionComposer.module.css'

/**
 * Displayed feedback: validation feedback is stored as a dictionary KEY and
 * translated at render, so already-shown feedback follows a locale switch;
 * runtime failure messages (finished strings from the wire) pass through
 * verbatim.
 */
type Feedback = { key: 'error.incomplete' | 'error.unanswered' } | { text: string }

/**
 * Split the conventional recommendation suffix without changing the answer value.
 * @param label - Original option label returned if selected.
 * @returns Display label plus recommendation state.
 */
export function parseRecommendedLabel(label: string): { label: string; recommended: boolean } {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i
  return suffix.test(label)
    ? { label: label.replace(suffix, ''), recommended: true }
    : { label, recommended: false }
}

/** Return whether a text-field key event belongs to an active IME composition. */
function isComposing(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  // keyCode 229 is the legacy IME-composition signal engines emit without isComposing.
  // oxlint-disable-next-line typescript/no-deprecated
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
}

/** The free-text answer field shared by both question variants. */
interface AnswerFieldProps {
  /** Visual variant: the custom row's inline column or the optionless question's framed block. */
  variant: 'inline' | 'block'
  /** Current draft text. */
  value: string
  /** Empty-field prompt. */
  placeholder: string
  /** Whether a submission in flight has frozen the field. */
  disabled: boolean
  /** Whether this field takes focus on mount. */
  autoFocus?: boolean
  /** Called when the field takes focus. */
  onFocus?: () => void
  /** Called with each edit of the draft. */
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  /** Called with each key press, before the browser's own handling. */
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
}

/**
 * Auto-growing free-text answer: a textarea, so a long answer soft-wraps and
 * Shift+Enter breaks a line, over a hidden mirror that owns the height.
 *
 * The mirror renders the draft plus a trailing newline in normal flow and so
 * sizes the grid row (counting rows by '\n' cannot see soft wraps); the
 * textarea shares that one cell and stretches to it, and `rows={1}` keeps the
 * control's own intrinsic height out of the row sizing so the mirror alone
 * decides. Past the mirror's cap the textarea scrolls itself — it is the only
 * scrollport in the stack, there being no second glyph layer to keep aligned.
 * Mirror and textarea MUST share font, line-height, padding and wrapping rules
 * or the two heights diverge.
 *
 * @param props - visual variant, draft text, and the field's event handlers.
 * @returns The mirrored auto-growing field.
 */
function AnswerField(props: AnswerFieldProps) {
  return (
    <div className={clsx(css.field, props.variant === 'inline' ? css.customInline : css.customBlock)}>
      <div aria-hidden className={css.fieldMirror}>{`${props.value}\n`}</div>
      <textarea
        autoFocus={props.autoFocus}
        className={css.fieldInput}
        value={props.value}
        disabled={props.disabled}
        rows={1}
        placeholder={props.placeholder}
        onFocus={props.onFocus}
        onChange={props.onChange}
        onKeyDown={props.onKeyDown}
      />
    </div>
  )
}

type QuestionFlowProps = {
  pending: QuestionPresentation
  progress: QuestionDraftProgress
  onProgress: (progress: QuestionDraftProgress) => void
  onClear?: (() => void) | undefined
  disabled?: boolean | undefined
  releaseBusyOnResolve?: boolean | undefined
  t: TranslateNS<'question'>
}

/** Shared generic question composer driven by explicit presentation state.
 * @param props - pending question, locale, draft progress and available actions.
 * @returns the generic question flow.
 */
export function QuestionFlow({ pending, t, progress, onProgress, onClear, disabled: externallyDisabled = false,
  releaseBusyOnResolve = false }: QuestionFlowProps) {
  const questions = pending.questions
  const markdownLabels = useMemo(() => ({
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])
  const { index, drafts } = progress
  const [busy, setBusy] = useState<'answer' | 'cancel' | null>(null)
  const [error, setError] = useState<Feedback | null>(null)
  // Collapsed to the header strip so the conversation above stays readable
  // while the user decides; the owner supplies the draft state.
  const [minimized, setMinimized] = useState(false)
  // The free-form textarea autofocuses on first presentation; re-expanding a
  // collapsed question must not steal focus from the expand toggle back into
  // the input, so focus is granted once per question index.
  const focusedQuestions = useRef(new Set<number>())
  const flowDisabled = busy !== null || externallyDisabled
  // Every navigation write stays in bounds and drafts mirrors questions 1:1.
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const question = questions[index]!
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const draft = drafts[index]!
  const hasOptions = (question.options?.length ?? 0) > 0

  const replaceProgress = (nextIndex: number, nextDrafts: QuestionDraftAnswer[]): void => {
    onProgress({ index: nextIndex, drafts: nextDrafts })
  }

  const cancelFlow = (): void => {
    setBusy('cancel')
    setError(null)
    const cancel = pending.cancel
    if (cancel === undefined) return
    void cancel()
      .then(() => { onClear?.() })
      .catch((cause: unknown) => {
        setBusy(null)
        setError({ text: cause instanceof Error ? cause.message : String(cause) })
      })
  }

  const updateDraft = (
    update: (current: QuestionDraftAnswer) => QuestionDraftAnswer,
    nextIndex = index,
  ): void => {
    const nextDrafts = drafts.map((item, itemIndex) => itemIndex === index ? update(item) : item)
    replaceProgress(nextIndex, nextDrafts)
    setError(null)
  }

  const choose = (label: string): void => {
    updateDraft((current) => {
      if (question.multiSelect === true) {
        const selected = current.selected.includes(label)
          ? current.selected.filter(item => item !== label)
          : [...current.selected, label]
        return { ...current, selected, skipped: false }
      }
      return { selected: [label], custom: '', skipped: false }
    }, question.multiSelect !== true && index < questions.length - 1 ? index + 1 : index)
  }

  const answered = (item: QuestionDraftAnswer): boolean =>
    item.selected.length > 0 || item.custom.trim() !== ''

  const completed = (item: QuestionDraftAnswer): boolean => answered(item) || item.skipped

  const submitDrafts = (values: QuestionDraftAnswer[]): void => {
    const missing = values.findIndex(item => !completed(item))
    if (missing >= 0) {
      replaceProgress(missing, values)
      setError({ key: 'error.incomplete' })
      return
    }
    const answer: QuestionAnswer = {
      answers: questions.map((item, itemIndex) => {
        const value = values[itemIndex] as QuestionDraftAnswer
        if (value.skipped) return { id: item.id, selected: [] }
        const custom = value.custom.trim()
        return {
          id: item.id,
          selected: custom === '' || item.multiSelect === true ? value.selected : [],
          ...(custom === '' ? {} : { custom }),
        }
      }),
    }
    setBusy('answer')
    setError(null)
    void pending.answer(answer)
      .then(() => { onClear?.(); if (releaseBusyOnResolve) setBusy(null) })
      .catch((cause: unknown) => {
        setBusy(null)
        setError({ text: cause instanceof Error ? cause.message : String(cause) })
      })
  }

  const continueFlow = (): void => {
    if (!answered(draft)) {
      setError({ key: 'error.unanswered' })
      return
    }
    if (index < questions.length - 1) {
      replaceProgress(index + 1, drafts)
      setError(null)
      return
    }
    submitDrafts(drafts)
  }

  // Shared by the inline custom field and the optionless one: a multi-select
  // draft retains checked labels, while a single-select custom answer replaces
  // its selection. Enter continues the flow, Shift+Enter breaks a line.
  const draftCustom = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = event.target.value
    updateDraft(current => ({
      ...current,
      selected: question.multiSelect === true ? current.selected : [],
      custom: value,
      skipped: false,
    }))
  }

  const continueFromCustom = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || isComposing(event)) return
    event.preventDefault()
    continueFlow()
  }

  const skipQuestion = (): void => {
    const nextDrafts = drafts.map((item, itemIndex) => itemIndex === index
      ? { selected: [], custom: '', skipped: true }
      : item)
    replaceProgress(index < questions.length - 1 ? index + 1 : index, nextDrafts)
    setError(null)
    if (index < questions.length - 1) {
      return
    }
    submitDrafts(nextDrafts)
  }

  return (
    <div className={css.frame} data-question-key={pending.key}>
      <section
        className={clsx(css.card, minimized && css.cardMinimized)}
        aria-labelledby={`question-${pending.key}-${String(index)}`}
      >
        <header className={css.header}>
          <div className={css.headingBlock}>
            {question.header !== undefined && <div className={css.eyebrow}>{question.header}</div>}
            <h2 className={css.title} id={`question-${pending.key}-${String(index)}`}>
              {question.question}
            </h2>
          </div>
          <div className={css.headerActions}>
            <button
              type="button" className={css.iconButton}
              aria-label={t(minimized ? 'nav.maximize' : 'nav.minimize')}
              title={t(minimized ? 'nav.maximize' : 'nav.minimize')}
              aria-expanded={!minimized}
              disabled={flowDisabled}
              onClick={() => { setMinimized(current => !current) }}
            >
              {minimized ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
            </button>
            {pending.cancel === undefined ? null : <button
              type="button" className={css.iconButton} aria-label={t('nav.cancel')}
              title={t('nav.cancel')}
              disabled={flowDisabled} onClick={cancelFlow}
            >
              <IconCloseOutline16 />
            </button>}
          </div>
        </header>

        {!minimized && (
          <>
            <div className={css.body} data-question-scroll>
              {question.detail !== undefined && (
                <div className={css.detail}><MarkdownText text={question.detail} labels={markdownLabels} /></div>
              )}
              <div className={css.options} role={question.multiSelect === true ? 'group' : 'radiogroup'}>
                {(question.options ?? []).map((option, optionIndex) => {
                  const selected = draft.selected.includes(option.label)
                  const display = parseRecommendedLabel(option.label)
                  return (
                    <button
                      type="button" key={`${option.label}-${String(optionIndex)}`}
                      className={clsx(css.option, selected && question.multiSelect !== true && css.optionSelected)}
                      role={question.multiSelect === true ? 'checkbox' : 'radio'}
                      aria-checked={selected}
                      aria-label={display.label}
                      disabled={flowDisabled}
                      onClick={() => { choose(option.label) }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' || !drafts.every(completed)) return
                        event.preventDefault()
                        submitDrafts(drafts)
                      }}
                    >
                      {question.multiSelect === true
                        ? (
                          <span className={clsx(css.checkbox, selected && css.checkboxChecked)} aria-hidden="true">
                            {selected && <IconCheckOutline14 size={12} />}
                          </span>
                        )
                        : <span className={css.number}>{optionIndex + 1}</span>}
                      <span className={css.optionCopy}>
                        <span className={css.optionLine}>
                          <span className={css.optionLabel}>{display.label}</span>
                          {display.recommended && (
                            <span className={css.badge}>{t('option.recommended')}</span>
                          )}
                          {option.description !== undefined && (
                            <span className={css.description}>{option.description}</span>
                          )}
                        </span>
                      </span>
                    </button>
                  )
                })}

                {hasOptions
                  ? (
                    <div className={clsx(css.customRow, draft.custom !== '' && css.customRowActive)}>
                      {question.multiSelect === true
                        ? (
                          <span
                            className={clsx(css.checkbox, draft.custom !== '' && css.checkboxChecked)}
                            aria-hidden="true"
                          >
                            {draft.custom !== '' && <IconCheckOutline14 size={12} />}
                          </span>
                        )
                        : (
                          <span className={css.number} aria-hidden="true">
                            <IconEditOutline16 size={12} />
                          </span>
                        )}
                      <AnswerField
                        variant="inline"
                        value={draft.custom}
                        disabled={flowDisabled}
                        placeholder={t('custom.placeholder')}
                        onChange={draftCustom}
                        onKeyDown={continueFromCustom}
                      />
                    </div>
                  )
                  : (
                    <AnswerField
                      autoFocus={!focusedQuestions.current.has(index)}
                      variant="block"
                      value={draft.custom}
                      disabled={flowDisabled}
                      placeholder={t('custom.placeholder')}
                      onFocus={() => { focusedQuestions.current.add(index) }}
                      onChange={draftCustom}
                      onKeyDown={continueFromCustom}
                    />
                  )}
              </div>
            </div>

            <footer className={css.footer}>
              <div className={css.pager}>
                <button
                  type="button" className={css.iconButton} aria-label={t('nav.prev')}
                  disabled={index === 0 || flowDisabled}
                  onClick={() => { replaceProgress(index - 1, drafts); setError(null) }}
                >
                  <IconChevronLeftOutline14 />
                </button>
                <span className={css.progress}>{index + 1} / {questions.length}</span>
                <button
                  type="button" className={css.iconButton} aria-label={t('nav.next')}
                  disabled={index === questions.length - 1 || flowDisabled}
                  onClick={() => { replaceProgress(index + 1, drafts); setError(null) }}
                >
                  <IconChevronRightOutline14 />
                </button>
              </div>
              <div className={css.feedback} role="status">
                {error === null ? null : 'key' in error ? t(error.key) : error.text}
              </div>
              <div className={css.footerActions}>
                <Button variant="outline" disabled={flowDisabled} onClick={skipQuestion}>
                  {t('action.skip')}
                </Button>
                <Button
                  variant="primary"
                  disabled={flowDisabled || !answered(draft)} onClick={continueFlow}
                >
                  {busy === 'answer'
                    ? t('submitting')
                    : index === questions.length - 1 ? t('submit') : t('action.next')}
                </Button>
              </div>
            </footer>
          </>
        )}
      </section>
    </div>
  )
}
