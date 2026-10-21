/** Deterministic Chinese scheduling phrases; all wall clocks use UTC+8. */
const number = '[0-9]+(?:\\.[0-9]+)?|半|[零〇一二两三四五六七八九十百千]+'
const unit = '秒钟?|分钟|分|个?小时|钟头|刻钟|天|周|星期'
const part = new RegExp(`(${number})\\s*(${unit})(半)?`, 'gu')

function chineseNumber(raw: string): number {
  if (raw === '半') return 0.5
  if (/^[0-9.]+$/u.test(raw)) return Number(raw)
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  let sum = 0
  let digit = 0
  for (const c of raw) {
    const scale = c === '十' ? 10 : c === '百' ? 100 : c === '千' ? 1000 : 0
    if (scale) { sum += (digit || 1) * scale; digit = 0 }
    else digit = digit * 10 + (digits[c] ?? NaN)
  }
  return sum + digit
}

function durationSeconds(text: string): number | undefined {
  const normalized = text.replace(/一个半小时/gu, '1.5小时').replace(/一个半钟头/gu, '1.5钟头').replace(/\s+/gu, '')
  let consumed = ''
  let seconds = 0
  for (const m of normalized.matchAll(part)) {
    consumed += m[0]
    const factor = /小时|钟头/u.test(m[2] ?? '') ? 3600 : /刻/u.test(m[2] ?? '') ? 900
      : /分/u.test(m[2] ?? '') ? 60 : m[2] === '天' ? 86400 : /周|星期/u.test(m[2] ?? '') ? 604800 : 1
    seconds += (chineseNumber(m[1] ?? '') + (m[3] ? 0.5 : 0)) * factor
  }
  return consumed === normalized && seconds > 0 && seconds <= 31536000 && Number.isSafeInteger(seconds) ? seconds : undefined
}

/** Only timing clauses are searched, never quoted content or a task result. */
function timingText(prompt: string): string {
  return prompt.normalize('NFKC').replace(/[“「『][^”」』]*[”」』]|"[^"\n]*"/gu, '')
}

/** Read an explicit countdown from a scheduling instruction.
 * @param prompt - User scheduling instruction.
 * @returns Seconds, or undefined when no such rule is present.
 */
export function relativeSeconds(prompt: string): number | undefined {
  const text = timingText(prompt).replace(/(?:两个|两)半小时/gu, '2.5小时')
  if (/每(?:隔)?/u.test(text)) return undefined
  const m = /^(?:请|麻烦|帮我|请帮我|在|过|再过|等|从现在起|从现在开始|提醒我|叫我|通知我|提醒一下我|\s)*(.*?)(?:以后|之后|后)/u.exec(text)
  if (m) return durationSeconds(m[1] ?? '')
  const after = /^(?:请)?(?:再过|过|等)\s*(.+?)(?=提醒|叫我|通知|执行|运行)/u.exec(text)
  if (after) return durationSeconds(after[1] ?? '')
  const tail = /(?:提醒我|叫我|通知我).*?[，,]\s*(.+?)(?:以后|之后|后)(?:提醒|叫我|通知|执行|$)/u.exec(text)
  return tail ? durationSeconds(tail[1] ?? '') : undefined
}

/** Read a fixed recurrence, rejecting mixed or unsupported rules.
 * @param prompt - User scheduling instruction.
 * @returns Seconds, or undefined when no such rule is present.
 */
export function repeatedSeconds(prompt: string): number | undefined {
  const text = timingText(prompt).replace(/每(小时|分钟|秒钟|秒)(?![一二三四五六日天])/gu, '每1$1')
  if (/只.*?[0-9一二三四五六七八九十]+次|共.*?[0-9一二三四五六七八九十]+次/u.test(text)) {
    throw new Error('请用截止时间或持续时间限定周期，暂不支持按次数结束。')
  }
  if (/每月|每年|工作日|节假日|周末|隔天|隔日/u.test(text)) throw new Error('请明确执行日期；此日历规则暂不支持自动创建。')
  if (/每天|每日/u.test(text)) {
    if (/每(?:隔)?[0-9半一二两三四五六七八九十]|每(?:周|星期|礼拜)/u.test(text)) throw new Error('检测到多个周期，请拆成不同任务。')
    return 86400
  }
  if (/每(?:周|星期|礼拜)[一二三四五六日天1-7]/u.test(text)) {
    if (/每(?:隔)?[0-9半一二两三四五六七八九十]/u.test(text)) throw new Error('检测到多个周期，请拆成不同任务。')
    return 604800
  }
  const pattern = new RegExp(`每(?:隔)?\\s*((?:(?:${number})\\s*(?:${unit})(?:半)?\\s*)+)`, 'gu')
  const values = [...text.matchAll(pattern)].map(m => durationSeconds((m[1] ?? '').trim()))
  if (!values.length) return undefined
  if (values.some(v => v === undefined)) throw new Error('请写明有效的周期和单位，例如每5分钟。')
  if (new Set(values).size > 1) throw new Error('任务描述中有多个不同的重复间隔，请只保留一个。')
  return values[0]
}

/** Read the total window duration independently of the repeat interval.
 * @param prompt - User scheduling instruction.
 * @returns Seconds, or undefined when no such rule is present.
 */
export function durationLimit(prompt: string): number | undefined {
  if (/持续提醒/u.test(prompt) && !/持续\s*[0-9半零一二两三四五六七八九十]/u.test(prompt)) return undefined
  const m = /(?:持续时间为|总共持续|持续)\s*(.+?)(?=[，,。；;]|$)/u.exec(timingText(prompt))
  if (!m) return undefined
  const value = durationSeconds(m[1] ?? '')
  if (value === undefined) throw new Error('请填写有效的持续时间和单位。')
  return value
}

/** Resolve a single date and clock, rejecting ambiguous multiple clocks.
 * @param prompt - User scheduling instruction.
 * @param now - Current epoch milliseconds.
 * @param ending - Read the cutoff clause instead of the execution clause.
 * @returns Epoch milliseconds, or undefined when no clock is present.
 */
export function clockTime(prompt: string, now: number, ending = false): number | undefined {
  const full = timingText(prompt)
  const cutoff = new RegExp('(?:直到|截至|截止到?|到)(?=今天|明天|后天|今晚|凌晨|早上|上午|中午|下午|晚上|[0-9零一二三四五六七八九十]+[:点月日号])', 'u')
  const split = full.search(cutoff)
  const text = ending ? (split < 0 ? '' : full.slice(split).replace(cutoff, '')) : split < 0 ? full : full.slice(0, split)
  const numericClock = /(?<![0-9.:+-])([0-9]{1,2})[:：]([0-9]{1,2})(?::([0-9]{1,2}))?(?![0-9:])/u
  const chineseClock = /([0-9零〇一二两三四五六七八九十]+)点(?:(半|一刻|三刻)|([0-9零〇一二两三四五六七八九十]+)分?)?/u
  const pattern = new RegExp(`${numericClock.source}|${chineseClock.source}`, 'gu')
  const clocks = [...text.matchAll(pattern)]
  if (!clocks.length) return undefined
  if (clocks.length > 1) throw new Error('检测到多个执行时间，请拆成不同任务。')
  const m = clocks[0]
  if (!m) return undefined
  let hour = chineseNumber(m[1] ?? m[4] ?? '')
  const minute = m[2] !== undefined ? Number(m[2]) : m[5] === '半' ? 30 : m[5] === '一刻' ? 15
    : m[5] === '三刻' ? 45 : m[6] ? chineseNumber(m[6]) : 0
  const second = Number(m[3] ?? 0)
  const prefix = text.slice(0, m.index)
  if (/下个?月|明年|农历|阴历/u.test(prefix)) throw new Error('请填写明确的公历日期。')
  if (/晚上|今晚|明晚/u.test(prefix) && hour === 12) throw new Error('请用明确日期的00:00表示午夜。')
  if (/下午|晚上|傍晚|今晚|明晚|中午/u.test(prefix) && hour < 12) hour += 12
  if (/凌晨/u.test(prefix) && hour === 12) hour = 0
  if (/早上|上午|清晨/u.test(prefix) && hour > 12) throw new Error('上午时间应在0至12点之间。')
  if (hour > 23 || minute > 59 || second > 59) throw new Error('请填写有效的北京时间。')
  const local = new Date(now + 28800000)
  let year = local.getUTCFullYear(), month = local.getUTCMonth() + 1, day = local.getUTCDate()
  const explicit = /(?:(\d{4})[-/年])?(\d{1,2})[-/月](\d{1,2})(?:日|号)?/u.exec(prefix)
  let date: number
  if (explicit) {
    year = Number(explicit[1] ?? year); month = Number(explicit[2]); day = Number(explicit[3])
    date = Date.UTC(year, month - 1, day)
    const check = new Date(date)
    if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) {
      throw new Error('日期不存在，请修改。')
    }
  } else {
    let offset = /前天/u.test(prefix) ? -2 : /昨天|昨日/u.test(prefix) ? -1 : /大后天/u.test(prefix) ? 3
      : /后天/u.test(prefix) ? 2 : /明天|明早|明晚/u.test(prefix) ? 1 : 0
    const weekday = /(下下|下|本|这|每)?(?:周|星期|礼拜)([一二三四五六日天1-7])/u.exec(prefix)
    if (weekday) {
      const target = '日一二三四五六'.indexOf(weekday[2] === '天' ? '日' : weekday[2] ?? '')
      const wanted = target < 0 ? Number(weekday[2]) % 7 : target
      const today = local.getUTCDay()
      offset = ((wanted + 6) % 7) - ((today + 6) % 7) + (weekday[1] === '下' ? 7 : weekday[1] === '下下' ? 14 : 0)
      if (weekday[1] === '每' && offset < 0) offset += 7
    }
    date = Date.UTC(year, month - 1, day + offset)
  }
  let time = date + (hour * 3600 + minute * 60 + second) * 1000 - 28800000
  if (!ending && /每天|每日|每(?:周|星期|礼拜)/u.test(prefix) && time <= now) {
    time += /每天|每日/u.test(prefix) ? 86400000 : 604800000
  }
  return time
}
