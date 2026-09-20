import { clockTime, relativeSeconds, repeatedSeconds, durationLimit } from './natural-time.ts'
/** Beijing wall-clock values are independent of the operating system timezone.
 * @param now - Current Unix time in milliseconds.
 * @param milliseconds - Include the millisecond fraction when true.
 * @returns Beijing date and time, or an em dash for invalid input.
 */
export function readableBeijingTime(now: number, milliseconds = false): string {
  if (!Number.isFinite(now)) return '—'
  const value = beijingInput(now)
  const fraction = milliseconds ? new Date(now).toISOString().slice(19, 23) : ''
  return `${value.slice(0, 4)}/${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))} ${value.slice(11, 19)}${fraction}`
}
/** Beijing date-time input value with second precision.
 * @param now - Current Unix time in milliseconds.
 * @returns Beijing wall-clock value for a datetime-local input.
 */
export function beijingInput(now: number): string {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 19)
}
/** Parse a form wall-clock value as Beijing time, never as device-local time.
 * @param value - Wall-clock input in YYYY-MM-DDTHH:mm[:ss] format.
 * @returns Unix milliseconds, or NaN for invalid input.
 */
export function parseBeijing(value: string): number {
  const normalized = value.length === 16 ? `${value}:00` : value
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(normalized)) return NaN
  const time = Date.parse(`${normalized}+08:00`)
  return Number.isFinite(time) && beijingInput(time) === normalized ? time : NaN
}
/** Resolve explicit Beijing clock phrases, defaulting undated clocks to today.
 * @param prompt - Task instructions containing the requested timing.
 * @param now - Current Unix time in milliseconds.
 * @returns Requested execution instant, or undefined without a clock.
 */
export function reminderAbsoluteTime(prompt: string, now = Date.now()): number | undefined {
  return clockTime(prompt, now)
}
/** Resolve a concrete countdown without losing units.
 * @param prompt - Task instructions containing the requested timing.
 * @returns Countdown in seconds, or undefined without a delay.
 */
export function reminderDelay(prompt: string): number | undefined {
  return relativeSeconds(prompt)
}
/** Resolve the explicit cutoff separately from the execution time.
 * @param prompt - Task instructions containing the requested timing.
 * @param now - Current Unix time in milliseconds.
 * @returns Exclusive cutoff instant, or undefined without a cutoff.
 */
export function reminderEndTime(prompt: string, now = Date.now()): number | undefined {
  return clockTime(prompt, now, true)
}
/** Resolve an exact relative delay at server admission, retaining millisecond precision.
 * @param seconds - Positive integral wait in seconds.
 * @param now - Current Unix time in milliseconds.
 * @returns RFC 3339 execution instant.
 */
export function delayedTime(seconds: number, now: number): string {
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 31536000) throw new Error('Invalid delay seconds')
  return new Date(now + seconds * 1000).toISOString()
}

/** Only explicit personal reminders bypass Agent execution; goals always use the Agent.
 * @param task - Task kind and instructions.
 * @returns Whether this task only delivers a personal reminder.
 */
export function isDirectReminder(task: { kind?: string | undefined; prompt: string }): boolean {
  if (task.kind === 'goal' || !/(?:提醒(?:一下)?我|叫我|通知我|给我(?:一个)?提醒)/u.test(task.prompt)) return false
  const intent = task.prompt.search(/提醒(?:一下)?我|叫我|通知我|给我(?:一个)?提醒/u)
  if (/检查|运行|执行|修改|修复|生成|整理|搜索|读取|发送邮件/u.test(task.prompt.slice(0, intent))) return false
  if (/^(?:请)?\s*提醒我/u.test(task.prompt.trim())) return true
  try {
    return reminderDelay(task.prompt) !== undefined || reminderInterval(task.prompt) !== undefined
      || reminderAbsoluteTime(task.prompt) !== undefined
  } catch { return false }
}

/** Resolve a fixed repeat interval, including Beijing daily and weekly clocks.
 * @param prompt - Task instructions containing the requested timing.
 * @returns Repeat interval in seconds, or undefined for a one-shot request.
 */
export function reminderInterval(prompt: string): number | undefined {
  return repeatedSeconds(prompt)
}
/** Resolve the overall duration of a recurring task.
 * @param prompt - Task instructions containing the requested timing.
 * @returns Overall duration in seconds, or undefined without a duration.
 */
export function reminderDuration(prompt: string): number | undefined {
  return durationLimit(prompt)
}

/** Whether the description explicitly asks the plan to continue until manually stopped.
 * @param prompt - Task instructions containing the requested timing.
 * @returns Whether manual stopping was explicitly requested.
 */
export function reminderHasNoEnd(prompt: string): boolean {
  return /直到(?:我)?手动停止|不设结束时间|一直提醒|持续提醒/u.test(prompt)
}

/** Reject contradictory scheduling instructions at both GUI and tool admission.
 * @param input - Parsed schedule to compare with its original instructions.
 * @param now - Current Unix time in milliseconds.
 */
export function validateTimingDescription(input: {
  prompt: string
  kind?: string | undefined
  at?: string | undefined
  everySeconds?: number | undefined
  delaySeconds?: number | undefined
  endAt?: string | undefined
}, now = Date.now()): void {
  if (/每月|每年|工作日|周末/u.test(input.prompt)) throw new Error('此日历规则暂不支持自动创建。')
  const cutoff = reminderEndTime(input.prompt, now)
  if (cutoff !== undefined && (!input.endAt || Date.parse(input.endAt) !== cutoff)) throw new Error('描述的截止时间与时间设置不一致。')
  const interval = reminderInterval(input.prompt)
  if (interval !== undefined) {
    if (input.kind === 'goal') throw new Error('周期提醒请选择“定时任务”，目标任务不能按周期重复。')
    if (input.everySeconds !== interval) throw new Error('任务描述的重复间隔与时间设置不一致，请修改后创建。')
  } else if (/每(?:隔)?\s*[0-9一二两三四五六七八九十百]+/u.test(input.prompt)) {
    throw new Error('未识别出明确的周期单位，请写成“每5分钟”或“每300秒”。')
  }
  const delay = reminderDelay(input.prompt)
  if (delay !== undefined && input.delaySeconds !== delay) throw new Error('任务描述的等待时间与时间设置不一致，请修改后创建。')
  const absolute = reminderAbsoluteTime(input.prompt, now)
  if (/每天|每日|每(?:周|星期|礼拜)/u.test(input.prompt) && absolute === undefined) throw new Error('请写明几点执行。')
  if (absolute !== undefined && input.delaySeconds !== undefined) throw new Error('具体时刻与倒计时不能同时设置。')
  if (absolute !== undefined && (!input.at || Date.parse(input.at) !== absolute)) throw new Error('任务描述的具体时间与时间设置不一致，请修改后创建。')
  const duration = reminderDuration(input.prompt)
  if (duration !== undefined) {
    if (input.everySeconds === undefined) throw new Error('持续时间只能用于周期任务，请在描述中写明“每几分钟”。')
    if (duration <= input.everySeconds) throw new Error('持续时间必须长于重复间隔，才能至少执行一次。')
    if (!input.at || !input.endAt || Date.parse(input.endAt) - Date.parse(input.at) !== duration * 1000) {
      throw new Error('任务描述的持续时间与时间设置不一致，请修改后创建。')
    }
  }
  if (reminderHasNoEnd(input.prompt) && input.endAt !== undefined) throw new Error('描述要求手动停止，请选择“不设结束时间”。')
}
