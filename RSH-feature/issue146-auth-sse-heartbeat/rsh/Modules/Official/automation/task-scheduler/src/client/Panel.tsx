/** Settings panel for direct, non-model task creation and management. */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { createSchedulerController } from './controller.ts'
import css from './panel.module.css'
import { scheduleEnded } from './schedule-state.ts'
import { schedulerError } from './errors.ts'
import { RunTiming } from './RunTiming.tsx'
import { beijingInput, parseBeijing, reminderAbsoluteTime, reminderEndTime, reminderDelay, readableBeijingTime, reminderDuration, reminderHasNoEnd, reminderInterval } from '../time.ts'

type Controller = ReturnType<typeof createSchedulerController>
/** Callbacks and observable source bound by the existing slot renderer. */
export interface PanelInjected {
  prepareSession: () => Promise<void>
  refresh: Controller['refresh']
  select: Controller['select']
  create: Controller['create']
  change: Controller['change']
  deleteRun: Controller['deleteRun']
  viewSession: (id: string) => void
  hooks: { snapshot: Controller['store'] }
}
/** Composed task-panel props, including framework-generated hooks and localization. */
export type PanelProps = PropsRuntime<'settings.section'> & PropsLocale<'taskScheduler'> & InjectFace<PanelInjected>

/** Keep the card concise while retaining full instructions in its tooltip. */
function goalSummary(text: string, criteria = false): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  const feature = criteria ? undefined : /(?:支持|实现)[^。！？]+/u.exec(normalized)?.[0]
  const sentence = feature ?? normalized.split(criteria ? /[，,。！？]/u : /[。！？]/u)[0] ?? ''
  const summary = sentence.length > 60 ? `${sentence.slice(0, 59)}…` : sentence
  return summary && !summary.endsWith('…') ? `${summary}。` : summary
}

function futureLocalTime(minutes = 0): string {
  return beijingInput(Date.now() + minutes * 60000)
}

function readTiming(prompt: string): { interval?: number; duration?: number; at?: number; end?: number; noEnd: boolean; error?: string } {
  try {
    const interval = reminderInterval(prompt)
    const duration = reminderDuration(prompt)
    const at = reminderAbsoluteTime(prompt)
    const end = reminderEndTime(prompt)
    return {
      ...(interval === undefined ? {} : { interval }), ...(duration === undefined ? {} : { duration }),
      ...(at === undefined ? {} : { at }), ...(end === undefined ? {} : { end }), noEnd: reminderHasNoEnd(prompt),
    }
  } catch (error) {
    return { noEnd: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Render task creation, owner-scoped plans and their execution receipts.
 * @param props - Registered callbacks, observable hooks and localized copy.
 * @returns The accessible settings page.
 */
export function SchedulerPanel({
  useSnapshot, refresh, select, create, change, deleteRun, viewSession, close, t, prepareSession, creationOnly = false,
}: PanelProps & { creationOnly?: boolean }): ReactNode {
  const state = useSnapshot(value => value)
  const [tab, setTab] = useState<'newTask' | 'tasks' | 'history'>(creationOnly ? 'newTask' : 'tasks')
  const [filter, setFilter] = useState<'all' | 'planned' | 'paused'>('all')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [goalTask, setGoalTask] = useState(true)
  const [criteria, setCriteria] = useState('')
  const [immediate, setImmediate] = useState(true)
  const [at, setAt] = useState(futureLocalTime)
  const [earliest, setEarliest] = useState(futureLocalTime)
  useEffect(() => {
    const timer = setInterval(() => {
      const now = futureLocalTime()
      setEarliest(now)

    }, 1000)
    return () => { clearInterval(timer) }
  }, [])
  const [endAt, setEndAt] = useState(() => futureLocalTime(65))
  const [noEnd, setNoEnd] = useState(false)
  const [recurring, setRecurring] = useState(false)
  const [scheduleOverride, setScheduleOverride] = useState<'once' | 'repeat' | null>(null)
  const [showTimingDetails, setShowTimingDetails] = useState(false)
  const [minutes, setMinutes] = useState('30')
  const [validation, setValidation] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [deletingRun, setDeletingRun] = useState<string | null>(null)
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (tab !== 'newTask') return
    let active = true
    void prepareSession().catch((error: unknown) => {
      if (active) setValidation(schedulerError(error instanceof Error ? error.message : String(error), t))
    })
    return () => { active = false }
  }, [tab, prepareSession, t])
  useEffect(() => {
    const timer = setInterval(() => { void refresh() }, 3000)
    return () => { clearInterval(timer) }
  }, [tab, refresh])
  const owner = state.owners.find(item => item.id === state.owner)
  const minimum = Math.ceil((state.data?.minEverySeconds ?? 300) / 60)
  const disabled = state.busy
  const date = readableBeijingTime
  const delay = reminderDelay(prompt)
  const inferred = useMemo(() => readTiming(prompt), [prompt])
  const inferredPeriodic = !goalTask && inferred.interval !== undefined
  const periodic = !goalTask && (scheduleOverride === 'once' ? false : scheduleOverride === 'repeat' ? true : inferredPeriodic || recurring)
  const intervalSeconds = periodic ? inferred.interval ?? Number(minutes) * 60 : undefined
  const timingSummary = inferred.error ?? t(periodic ? 'repeat' : 'once')
  const selectedOneShotTime = inferred.at ?? (!periodic && !immediate ? parseBeijing(at) : undefined)
  const pastExecution = !goalTask && !periodic && selectedOneShotTime !== undefined
    && Number.isFinite(selectedOneShotTime) && selectedOneShotTime <= Date.now()
  const expired = (end?: string): boolean => end !== undefined && Date.parse(end) <= Date.now()
  const plans = state.data?.tasks.filter(task => task.state === 'active' && !scheduleEnded(task, Date.now())) ?? []
  const paused = state.data?.tasks.filter(task => task.state === 'paused') ?? []
  const visibleTasks = filter === 'planned' ? plans : filter === 'paused' ? paused : state.data?.tasks ?? []
  return <section className={css.panel} aria-label={t('title')}>
    {!creationOnly && <><header className={css.header}><div><h2>{t('title')}</h2><p>{t('shortNotice')}</p></div>
      <div className={css.centerActions}>
        <button type="button" onClick={() => { setTab('tasks'); setFilter('all'); setValidation(null) }}>{t('tasks')}</button>
        <button type="button" className={css.primary} onClick={() => { setTab('newTask'); setValidation(null) }}>{t('newTask')}</button>
      </div></header>
    <div className={css.metrics}>
      <button type="button" aria-pressed={tab === 'tasks' && filter === 'planned'}
        onClick={() => { setFilter('planned'); setTab('tasks') }}><span>{t('planned')}</span><strong>{plans.length}</strong><small>↗</small></button>
      <button type="button" aria-pressed={tab === 'tasks' && filter === 'paused'}
        onClick={() => { setFilter('paused'); setTab('tasks') }}><span>{t('pausedCount')}</span><strong>{paused.length}</strong><small>↗</small></button>
      <button type="button" aria-pressed={tab === 'history'} onClick={() => { setTab('history') }}>
        <span>{t('executions')}</span><strong>{state.data?.runs.length ?? 0}</strong><small>↗</small></button>
    </div>
    </>}
    <div className={css.environment} hidden={tab !== 'newTask'}>
      <label className={css.field}>{t('session')}<select aria-label={t('session')} value={state.owner ?? ''} disabled={state.busy}
        onChange={(event) => { setValidation(null); setDeleting(null); void select(event.target.value as SessionId) }}>
        {!owner && <option value="">{t('choose')}</option>}
        {state.owners.map((item, index) => <option key={item.id} value={item.id}>{
          (!item.title.trim() || item.title === item.id || /^session-[0-9a-f-]+$/iu.test(item.title)
            ? `${item.workspace.split(/[\\/]/u).filter(Boolean).at(-1) || t('session')} · ${index + 1}`
            : item.title).slice(0, 36)
        }</option>)}
      </select></label>
      {!owner && <p>{t('noOwners')}</p>}
    </div>
    {(state.error || validation || pastExecution) && <p className={css.error} role="alert">{state.error ? schedulerError(state.error, t) : pastExecution ? t('pastBeijing') : validation}</p>}
    {state.notice && <p className={css.success} role="status">{t(state.notice)}</p>}
    <div hidden={tab !== 'newTask'}>
      <form className={css.form} onSubmit={(event) => {
        event.preventDefault()
        if (disabled) return
        if (!owner) { setValidation(t('noOwners')); return }
        if (!goalTask && inferred.error) { setValidation(inferred.error); return }
        if (!goalTask && scheduleOverride === 'once' && inferredPeriodic) { setValidation(t('singleConflictsDescription')); return }
        if (!goalTask && scheduleOverride === 'repeat' && (delay !== undefined || inferred.at !== undefined) && !inferredPeriodic) { setValidation(t('repeatConflictsDescription')); return }
        if (!goalTask && inferred.interval === undefined && delay === undefined && inferred.at === undefined && !showTimingDetails) { setValidation(t('timingMissing')); return }
        const current = futureLocalTime()
        if (!periodic && inferred.at !== undefined && inferred.at <= Date.now()) { setValidation(t('future')); return }
        if (!periodic && inferred.at === undefined && !immediate && (!Number.isFinite(parseBeijing(at)) || parseBeijing(at) <= Date.now())) { setValidation(t('future')); return }
        const start = inferred.at !== undefined ? beijingInput(inferred.at) : periodic || immediate ? current : at
        setAt(start)
        const parsed = parseBeijing(start)
        if (!Number.isFinite(parsed)) { setValidation(t('future')); return }
        // Minute-resolution "now" starts on the next scheduler tick.
        const instant = new Date(Math.max(parsed, Date.now() + 1000))
        const automatic = inferredPeriodic && !showTimingDetails
        const effectiveNoEnd = inferred.end === undefined
          && (inferred.noEnd || (automatic && inferred.duration === undefined) || noEnd)
        const end = inferred.end !== undefined ? new Date(inferred.end) : inferredPeriodic && inferred.duration !== undefined
          ? new Date(instant.getTime() + inferred.duration * 1000) : new Date(parseBeijing(endAt))
        if (periodic && !effectiveNoEnd && (!Number.isFinite(end.getTime()) || end.getTime() <= instant.getTime())) { setValidation(t('endInvalid')); return }
        if (periodic && (intervalSeconds === undefined || !Number.isSafeInteger(intervalSeconds) || intervalSeconds < minimum * 60)) { setValidation(t('invalidInterval')); return }
        if (automatic && inferred.duration !== undefined && intervalSeconds !== undefined && inferred.duration <= intervalSeconds) { setValidation(t('durationTooShort')); return }
        setValidation(null)
        void create({ title: title.trim() || prompt.trim().replace(/\s+/gu, ' ').slice(0, 32), prompt: prompt.trim(), at: instant.toISOString(),
          ...(periodic && inferred.at === undefined && intervalSeconds !== undefined ? { delaySeconds: intervalSeconds, delayFromAt: false }
            : delay === undefined ? {} : { delaySeconds: delay, delayFromAt: !immediate }),
          kind: goalTask ? 'goal' : 'scheduled', ...(goalTask ? { completionCriteria: criteria.trim() } : {}),
          ...(periodic && !effectiveNoEnd ? { endAt: end.toISOString() } : {}),
          ...(periodic && intervalSeconds !== undefined ? { everySeconds: intervalSeconds } : {}) }).then((ok) => { if (ok) { setTitle(''); setPrompt(''); setCriteria(''); setShowTimingDetails(false); if (creationOnly) close(); else setTab('tasks') } })
      }}>
        <div className={css.editorColumns}><section className={css.editorColumn}>
          <div className={css.sectionHeading}><span aria-hidden="true">01</span><div><h3>{t('taskInfo')}</h3><small>{t('taskInfoHelp')}</small></div></div>
          <div className={css.modePicker}>
            <button type="button" aria-pressed={goalTask} onClick={() => { setGoalTask(true); setRecurring(false); setScheduleOverride(null) }}>{t('goalTask')}</button>
            <button type="button" aria-pressed={!goalTask} onClick={() => {
              setGoalTask(false)
              setScheduleOverride(null)
              const timing = readTiming(prompt)
              if (timing.interval !== undefined) {
                setRecurring(true); setImmediate(true); setMinutes(String(timing.interval / 60)); setNoEnd(timing.duration === undefined)
              }
              if (timing.at !== undefined) { setImmediate(false); setAt(beijingInput(timing.at)) }
              if (timing.error) setValidation(timing.error)
            }}>{t('scheduledTask')}</button>
          </div>
          <label className={css.field}>{t('name')}<input maxLength={200} value={title} disabled={disabled}
            placeholder={t('nameHint')} onChange={(event) =>{  setTitle(event.target.value) }} /></label>
          <label className={css.field}>{t('prompt')}<textarea required maxLength={32000} rows={3} value={prompt} disabled={disabled}
            placeholder={t('promptHint')} onChange={(event) => {
              const text = event.target.value
              setPrompt(text)
              const timing = readTiming(text)
              if (timing.interval !== undefined && !goalTask) {
                setRecurring(true); setImmediate(true); setMinutes(String(timing.interval / 60)); setNoEnd(timing.duration === undefined)
              }
              if (timing.at !== undefined && !goalTask) { setImmediate(false); setAt(beijingInput(timing.at)) }
              setValidation(timing.error ?? null)
            }} /></label>
          {goalTask && <label className={css.field}>{t('criteria')}<textarea required maxLength={8000} value={criteria}
            disabled={disabled} placeholder={t('criteriaHint')} onChange={(event) => { setCriteria(event.target.value) }} /></label>}
        </section><section className={css.editorColumn}>
          <div className={css.sectionHeading}><span aria-hidden="true">02</span><div><h3>{t('timing')}</h3><small>{t('timingHelp')}</small></div></div>
          {!goalTask && <div className={css.scheduleSummary} data-error={Boolean(inferred.error)}>
            <strong>{timingSummary}</strong>
            <button type="button" disabled={disabled} aria-expanded={showTimingDetails} onClick={() => {
              const next = !showTimingDetails
              setShowTimingDetails(next)
              if (next && inferred.interval !== undefined) {
                setRecurring(true)
                setMinutes(String(inferred.interval / 60))
                setNoEnd(inferred.duration === undefined)
                if (inferred.duration !== undefined) setEndAt(futureLocalTime(inferred.duration / 60))
              }
            }}>{t(showTimingDetails ? 'hideTiming' : 'adjustTiming')}</button>
          </div>}
          {(goalTask || (showTimingDetails && !periodic && inferred.at === undefined)) && <label className={css.checkRow}><input type="checkbox" checked={immediate} onChange={(event) => { setImmediate(event.target.checked) }} />{delay === undefined ? t('startNow') : delay % 3600 === 0 ? `${delay / 3600} ${t('delayHoursLabel')}` : delay % 60 === 0 ? `${delay / 60} ${t('delayMinutesLabel')}` : `${delay} ${t('delaySecondsLabel')}`}</label>}
          {!goalTask && showTimingDetails && <div className={css.modePicker} role="group" aria-label={t('rule')}>
            <button type="button" disabled={disabled} aria-pressed={!periodic} onClick={() => {
              setScheduleOverride('once')
              setRecurring(false)
              setValidation(inferredPeriodic ? t('singleConflictsDescription') : null)
            }}>{t('once')}</button>
            <button type="button" disabled={disabled} aria-pressed={periodic} onClick={() => {
              setScheduleOverride('repeat')
              setRecurring(true)
              setImmediate(true)
              setValidation((delay !== undefined || inferred.at !== undefined) && !inferredPeriodic ? t('repeatConflictsDescription') : null)
            }}>{t('repeat')}</button>
          </div>}
          {!periodic && (goalTask || showTimingDetails) && (!immediate || inferred.at !== undefined) && <>
            <div className={css.grid}><label className={css.field}>{t(delay !== undefined ? 'countdownStart' : 'executionTime')}<input type="datetime-local" step="1" required min={earliest} value={inferred.at !== undefined ? beijingInput(inferred.at) : at}
              onChange={(event) => {
                const now = futureLocalTime()
                setEarliest(now)
                setAt(event.target.value)
                setValidation(null)
              }} disabled={disabled || inferred.at !== undefined} /></label></div>
            {inferred.at !== undefined && <small>{t('descriptionOwnsExecutionTime')}</small>}
          </>}
          {!periodic && (goalTask || showTimingDetails) && delay !== undefined && !immediate && <p>{t('reminderAt')}：{date(parseBeijing(at) + delay * 1000)}</p>}
          {showTimingDetails && periodic && <>
            <label className={css.field}>{t('endTime')}<input type="datetime-local" step="1" required={!noEnd && inferred.duration === undefined && !inferred.noEnd} min={earliest} value={
              inferred.duration !== undefined ? beijingInput(Date.now() + inferred.duration * 1000) : endAt
            } disabled={disabled || noEnd || inferred.duration !== undefined || inferred.noEnd}
            onChange={(event) => {
              const now = futureLocalTime()
              setEarliest(now)
              setEndAt(event.target.value)
              setValidation(null)
            }} /></label>
            <label className={css.checkRow}><input type="checkbox" checked={inferred.noEnd || noEnd} disabled={disabled || inferred.duration !== undefined || inferred.noEnd} onChange={(event) => { setNoEnd(event.target.checked) }} />{t('noEnd')}</label>
            {(inferred.duration !== undefined || inferred.noEnd) && <small>{t('descriptionOwnsEnd')}</small>}
          </>}
          {showTimingDetails && periodic && <label className={css.field}>{t('interval')}<input type="number" min={minimum} step="any" required value={minutes} disabled={disabled || inferred.interval !== undefined}
            onChange={(event) => { setMinutes(event.target.value) }} /></label>}
          {showTimingDetails && periodic && <small>{inferred.interval !== undefined ? t('descriptionOwnsInterval') : `${t('minimum')}${minimum}`}</small>}
        </section></div>
        <footer className={css.editorFooter}><button className={css.primary} type="submit" disabled={disabled || !owner || pastExecution}>{state.busy ? t('creating') : t('create')}</button></footer>
      </form>
    </div>
    <div hidden={tab !== 'tasks'}>
      <h3>{t(filter === 'planned' ? 'planned' : filter === 'paused' ? 'pausedCount' : 'tasks')} <span className={css.count}>{visibleTasks.length}</span></h3>
      {state.busy && <p role="status">{t('busy')}</p>}
      {!visibleTasks.length && <p className={css.empty}>{t(filter === 'all' ? 'empty' : 'noMatchingTasks')}</p>}
      {visibleTasks.map(task => <article className={css.card} key={task.id}>
        <div className={css.header}><strong>{task.title}</strong><span className={css.badge}>{task.kind === 'goal'
          ? t(state.data?.runs.find(run => run.taskId === task.id)?.state === 'completed' ? 'nativeCompleted' : `state.${state.data?.runs.find(run => run.taskId === task.id)?.state ?? task.state}`)
          : state.data?.runs.some(run => run.taskId === task.id && run.state === 'running') ? t('state.running')
            : t(scheduleEnded(task, Date.now()) ? 'planEnded' : task.state === 'paused' ? 'state.paused' : task.everySeconds !== undefined ? 'cycleActive' : `state.${task.state}`)}</span></div>
        <div className={css.planTimes}>{task.countdownStartedAt && <span>{t('countdownStart')}<strong>{date(Date.parse(task.countdownStartedAt))}</strong></span>}
          {task.nextAt !== null && !expired(task.endAt) && <span>{t(task.countdownStartedAt ? 'reminderAt' : 'executionTime')}<strong>{task.state === 'paused' && task.kind !== 'goal' ? t('countdownPaused') : date(task.nextAt)}</strong></span>}
          {task.everySeconds !== undefined && <span>{t('endTime')}<strong>{task.endAt ? date(Date.parse(task.endAt)) : t('unlimited')}</strong></span>}</div>
        <p className={css.prompt} title={task.kind === 'goal' ? task.prompt : undefined}>{task.kind === 'goal' ? goalSummary(task.prompt) : task.prompt}</p>
        {task.kind === 'goal' && <p title={task.completionCriteria}>{t('criteria')}：{goalSummary(task.completionCriteria ?? '', true)}</p>}
        {task.kind !== 'goal' && <small>{task.everySeconds ? `${t('repeat')} · ${task.everySeconds / 60} ${t('minutesUnit')}` : t('once')}
          {' · '}{task.state === 'paused' && task.pausedRemainingMs !== undefined && !expired(task.endAt)
            ? `${t('frozenCountdown')}：${Math.floor(Math.ceil(task.pausedRemainingMs / 1000) / 60)} ${t('minutesUnit')} ${Math.ceil(task.pausedRemainingMs / 1000) % 60} ${t('secondsUnit')}`
            : `${t('next')}：${task.nextAt === null || expired(task.endAt) ? t('noNext') : date(task.nextAt)}`}</small>}
        <div className={css.actions}>
          {task.kind === 'goal' && task.nextAt === null && state.data?.runs.find(run => run.taskId === task.id)?.state !== 'completed'
            && <button type="button" disabled={state.busy} onClick={() => { void change(task.id,
              state.data?.runs.find(run => run.taskId === task.id)?.state === 'running' ? 'pause' : 'resume') }}>{t(state.data?.runs.find(run => run.taskId === task.id)?.state === 'running' ? 'pause' : 'continueGoal')}</button>}
          {task.nextAt !== null && !expired(task.endAt) && <button type="button" disabled={state.busy} onClick={() => { void change(task.id, task.state === 'paused' ? 'resume' : 'pause') }}>{t(task.state === 'paused' ? 'resume' : 'pause')}</button>}
          <button type="button" disabled={state.busy} onClick={() =>{  setDeleting(task.id) }}>{t('remove')}</button>
        </div>
        {deleting === task.id && <div className={css.confirm}><p>{t('removeNote')}</p><button type="button" disabled={state.busy}
          onClick={() => { void change(task.id, 'delete').then((ok) => { if (ok) setDeleting(null) }) }}>{t('confirm')}</button>
        <button type="button" disabled={state.busy} onClick={() =>{  setDeleting(null) }}>{t('cancel')}</button></div>}
      </article>)}
    </div>
    <div hidden={tab !== 'history'}>
      <h3>{t('history')}</h3>
      {!state.data?.runs.length && <p className={css.empty}>{t('noRuns')}</p>}
      {state.data?.runs.map(run => <article key={run.id} className={css.card}>
        <div className={css.header}><strong>{run.title || state.data?.tasks.find(task => task.id === run.taskId)?.title || t('title')}</strong>
          <span>{t(run.detail === 'Reminder dispatched' ? 'reminderSent' : run.kind === 'goal' && run.state === 'completed' ? 'nativeCompleted' : `state.${run.state}`)}</span></div>
        {expanded !== run.id && <small>{t(run.detail === 'Reminder dispatched' ? 'remindedAt' : run.finishedAt === null ? 'actualStart' : run.state === 'completed' ? 'completedAt' : 'actualEnd')}：{date(run.finishedAt ?? run.startedAt)}</small>}
        <div className={css.actions}>
          {run.detail !== 'Reminder dispatched' && <button type="button" aria-expanded={expanded === run.id} onClick={() => { setExpanded(expanded === run.id ? null : run.id) }}>{t(expanded === run.id ? 'hideDetails' : 'showDetails')}</button>}
          {run.sessionId && <button type="button" onClick={() => { if (run.sessionId) { viewSession(run.sessionId); close() } }}>{t('viewResult')}</button>}
          <button type="button" disabled={state.busy || run.state === 'running'} onClick={() => { setDeletingRun(run.id) }}>{t('deleteRecord')}</button>
        </div>
        {deletingRun === run.id && <div className={css.confirm}><p>{t('deleteRecordNote')}</p>
          <button type="button" disabled={state.busy} onClick={() => { void deleteRun(run.id).then((ok) => { if (ok) setDeletingRun(null) }) }}>{t('confirm')}</button>
          <button type="button" disabled={state.busy} onClick={() => { setDeletingRun(null) }}>{t('cancel')}</button></div>}
        {run.detail !== 'Reminder dispatched' && expanded === run.id && <div>
          {state.data?.tasks.find(task => task.id === run.taskId)?.everySeconds !== undefined && <p>{t('repeatInterval')}：{(state.data.tasks.find(task => task.id === run.taskId)?.everySeconds ?? 0) / 60} {t('minutesUnit')}</p>}
          <RunTiming run={run} t={t} />
          {run.detail !== 'Reminder dispatched' && <p>{run.state === 'completed' ? t(run.kind === 'goal' ? 'goalCompletedDetail' : 'resultSummary') : run.detail}</p>}
        </div>}</article>)}
    </div>
  </section>
}
