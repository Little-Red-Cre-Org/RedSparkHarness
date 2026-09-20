import { expect, it } from 'vitest'
import { beijingInput, parseBeijing, reminderAbsoluteTime, reminderEndTime, reminderDelay, delayedTime, readableBeijingTime, isDirectReminder, reminderDuration, reminderHasNoEnd, reminderInterval, validateTimingDescription } from '../src/time.ts'

it('preserves a full two minutes across minute and day boundaries', () => {
  const now = Date.parse('2026-09-16T23:59:45.934+08:00')
  const at = delayedTime(reminderDelay('两分钟后提醒我发消息')!, now)
  expect(Date.parse(at) - now).toBe(120000)
  expect(beijingInput(Date.parse(at))).toBe('2026-09-17T00:01:45')
})
it('uses Beijing timezone regardless of system timezone and keeps seconds', () => {
  expect(parseBeijing('2026-09-16T08:46:45')).toBe(Date.parse('2026-09-16T00:46:45Z'))
  expect(beijingInput(Date.parse('2026-09-16T00:46:45Z'))).toBe('2026-09-16T08:46:45')
})
it('only infers explicit leading relative times and validates delays', () => {
  expect(reminderDelay('请在2分钟后提醒喝水')).toBe(120)
  expect(reminderDelay('十分钟后提醒')).toBe(600)
  expect(reminderDelay('检查两分钟后的日志')).toBeUndefined()
  expect(() => delayedTime(-1, Date.now())).toThrow()
})

it('formats Beijing timestamps with colons and limits direct delivery to reminders', () => {
  expect(readableBeijingTime(Date.parse('2026-09-16T02:33:45Z'))).toBe('2026/9/16 10:33:45')
  expect(readableBeijingTime(Date.parse('2026-09-16T02:33:45.007Z'), true)).toBe('2026/9/16 10:33:45.007')
  expect(isDirectReminder({ kind: 'scheduled', prompt: '每五分钟提醒我喝水' })).toBe(true)
  expect(isDirectReminder({ kind: 'goal', prompt: '每五分钟提醒我喝水' })).toBe(false)
  expect(isDirectReminder({ prompt: '检查代码并提醒我结果' })).toBe(false)
})

it.each([['每5分钟提醒我喝水', 300], ['每隔300秒提醒我喝水', 300], ['每半小时提醒我喝水', 1800], ['每1.5小时提醒我喝水', 5400], ['每十五分钟提醒我喝水', 900], ['每120分钟提醒我喝水', 7200]])('parses duration without losing units: %s', (prompt, seconds) => {
  expect(reminderInterval(prompt)).toBe(seconds)
})

it('resolves explicit wall-clock reminders in Beijing time', () => {
  const now = Date.parse('2026-09-16T06:00:00Z')
  const today = Date.parse('2026-09-16T08:30:00Z')
  expect(reminderAbsoluteTime('今天下午16:30提醒我参加会议', now)).toBe(today)
  expect(reminderAbsoluteTime('今天下午4:30提醒我参加会议', now)).toBe(today)
  expect(reminderAbsoluteTime('明天上午9点05分提醒我开会', now)).toBe(Date.parse('2026-09-17T01:05:00Z'))
  expect(isDirectReminder({ kind: 'scheduled', prompt: '今天下午16:30提醒我参加会议' })).toBe(true)
  expect(() =>{  validateTimingDescription({ prompt: '今天下午16:30提醒我参加会议', at: new Date(today).toISOString() }, now) }).not.toThrow()
  expect(() =>{  validateTimingDescription({ prompt: '今天下午16:30提醒我参加会议', at: new Date(today + 60000).toISOString() }, now) }).toThrow('不一致')
})
it('parses natural-language schedule endings', () => {
  expect(reminderDuration('每5分钟提醒我喝水，持续1小时')).toBe(3600)
  expect(reminderDuration('每10分钟检查一次，持续半小时')).toBe(1800)
  expect(reminderHasNoEnd('每5分钟提醒，直到我手动停止')).toBe(true)
  expect(reminderHasNoEnd('每5分钟提醒，持续1小时')).toBe(false)
})
it.each(['2026-02-30T10:00:00', '2026-09-16T25:00:00', '', '2026-09-16T10:00:00Z'])('rejects invalid Beijing wall clock %s', (value) => {
  expect(Number.isNaN(parseBeijing(value))).toBe(true)
})
it('accepts a leap day and minute precision and survives incomplete input', () => {
  expect(beijingInput(parseBeijing('2028-02-29T10:00'))).toBe('2028-02-29T10:00:00')
  expect(readableBeijingTime(NaN)).toBe('—')
})
it('rejects contradictions, missing units, unsupported calendar/end expressions and wrong task kinds', () => {
  expect(() =>{  validateTimingDescription({ prompt: '每5分钟提醒我喝水', everySeconds: 60 }) }).toThrow('不一致')
  expect(() =>{  validateTimingDescription({ prompt: '每隔30提醒我喝水' }) }).toThrow('单位')
  expect(() =>{  validateTimingDescription({ prompt: '每5分钟提醒我喝水', kind: 'goal', everySeconds: 300 }) }).toThrow('目标任务')
  expect(() =>{  validateTimingDescription({ prompt: '2分钟后提醒我喝水', delaySeconds: 2 }) }).toThrow('不一致')
  expect(() =>{  validateTimingDescription({ prompt: '每5分钟提醒我，之后每10分钟', everySeconds: 300 }) }).toThrow('多个')
  expect(() =>{  validateTimingDescription({ prompt: '每0分钟提醒我', everySeconds: 0 }) }).toThrow('有效')
  expect(() =>{  validateTimingDescription({ prompt: '每月早上8点提醒我', everySeconds: 86400 }) }).toThrow('日历')
  expect(() =>{  validateTimingDescription({ prompt: '每5分钟提醒我，持续20分钟', at: '2026-09-16T08:00:00Z', endAt: '2026-09-16T08:20:00Z', everySeconds: 300 }) }).not.toThrow()
  expect(() =>{  validateTimingDescription({ prompt: '每5分钟提醒我，持续20分钟', at: '2026-09-16T08:00:00Z', endAt: '2026-09-16T08:10:00Z', everySeconds: 300 }) }).toThrow('不一致')
  expect(() =>{  validateTimingDescription({ prompt: '每5分钟提醒我，直到我手动停止', everySeconds: 300, endAt: '2026-09-16T08:00:00Z' }) }).toThrow('不设结束时间')
  expect(() =>{  validateTimingDescription({ prompt: '每5分钟提醒我，直到我手动停止', everySeconds: 300 }) }).not.toThrow()
})

it.each([['半小时后提醒我', 1800], ['1.5分钟后提醒我', 90], ['一百零五分钟后提醒我', 6300]])('parses relative units %s', (prompt, seconds) => {
  expect(reminderDelay(prompt)).toBe(seconds)
  expect(isDirectReminder({ kind: 'scheduled', prompt })).toBe(true)
})

it.each(['17:00的时候叫我吃饭', '17：00提醒我吃饭', '下午5点叫我吃饭', '请在17:00提醒我吃饭'])('defaults undated clocks to today in Beijing: %s', (prompt) => {
  const now = Date.parse('2026-09-16T16:00:00+08:00')
  expect(reminderAbsoluteTime(prompt, now)).toBe(Date.parse('2026-09-16T17:00:00+08:00'))
  expect(isDirectReminder({ kind: 'scheduled', prompt })).toBe(true)
  expect(reminderAbsoluteTime(prompt, now + 7200000)).toBe(Date.parse('2026-09-16T17:00:00+08:00'))
})
it('rejects malformed clock values without mistaking durations for clocks', () => {
  expect(() => reminderAbsoluteTime('17:99叫我吃饭')).toThrow()
  expect(() => reminderAbsoluteTime('25:00叫我吃饭')).toThrow()
  expect(reminderAbsoluteTime('5分钟后叫我吃饭')).toBeUndefined()
  expect(reminderAbsoluteTime('17:000叫我吃饭')).toBeUndefined()
})

it.each([
  ['过五分钟提醒我喝水', 300], ['提醒我十分钟后吃饭', 600], ['一个半小时后叫我休息', 5400],
  ['1小时30分钟后通知我', 5400], ['两天后提醒我', 172800], ['一刻钟后提醒我', 900],
  ['半个小时后提醒我', 1800], ['三十秒后提醒我', 30],
])('understands countdown wording: %s', (text, seconds) =>{  expect(reminderDelay(text)).toBe(seconds) })
it.each([
  ['今晚八点半提醒我吃饭', '2026-09-16T20:30:00+08:00'],
  ['明早七点一刻叫我起床', '2026-09-17T07:15:00+08:00'],
  ['提醒我明天下午三点开会', '2026-09-17T15:00:00+08:00'],
  ['2026年10月1日9:30提醒我', '2026-10-01T09:30:00+08:00'],
  ['9月20号下午四点三刻提醒我', '2026-09-20T16:45:00+08:00'],
  ['下周一上午9点提醒我', '2026-09-21T09:00:00+08:00'],
  ['每天早上8点提醒我', '2026-09-17T08:00:00+08:00'],
  ['每周五下午三点提醒我', '2026-09-18T15:00:00+08:00'],
  ['17:00:30提醒我', '2026-09-16T17:00:30+08:00'],
])('understands Beijing calendar phrase: %s', (text, expected) => {
  const now = Date.parse('2026-09-16T16:00:00+08:00')
  expect(reminderAbsoluteTime(text, now)).toBe(Date.parse(expected))
})
it('resolves cutoff separately and preserves execution intent', () => {
  const now = Date.parse('2026-09-16T16:00:00+08:00')
  const text = '每5分钟提醒我喝水，直到今天18:00'
  expect(reminderAbsoluteTime(text, now)).toBeUndefined()
  expect(reminderEndTime(text, now)).toBe(Date.parse('2026-09-16T18:00:00+08:00'))
  expect(reminderInterval(text)).toBe(300)
  expect(isDirectReminder({ prompt: '5分钟后检查代码并提醒我结果' })).toBe(false)
  expect(isDirectReminder({ prompt: '5分钟后提醒我检查代码' })).toBe(true)
  expect(reminderAbsoluteTime('提醒我阅读“每天17:00”的说明', now)).toBeUndefined()
  expect(() => reminderAbsoluteTime('2026年2月30日9:00提醒我', now)).toThrow('日期不存在')
  expect(() => reminderAbsoluteTime('17:00和18:00提醒我', now)).toThrow('多个')
  expect(reminderDelay('过一会儿提醒我')).toBeUndefined()
})
it('admits daily clocks and prevents a countdown from replacing the clock', () => {
  const now = Date.parse('2026-09-16T16:00:00+08:00')
  const input = { prompt: '每天17:00提醒我吃饭', at: '2026-09-16T17:00:00+08:00', everySeconds: 86400 }
  expect(() =>{  validateTimingDescription(input, now) }).not.toThrow()
  expect(() =>{  validateTimingDescription({ ...input, delaySeconds: 86400 }, now) }).toThrow('不能同时')
})

it.each([['每小时提醒我喝水', 3600], ['每5分钟给我一个提醒', 300], ['每隔两小时帮我检查日志', 7200]])('parses intervals independently of the action wording: %s', (prompt, seconds) => {
  expect(reminderInterval(prompt)).toBe(seconds)
})

it('does not interpret continuous reminders as a malformed duration', () => {
  expect(reminderDuration('每5分钟提醒我喝水，持续提醒')).toBeUndefined()
  expect(reminderHasNoEnd('每5分钟提醒我喝水，持续提醒')).toBe(true)
  expect(reminderDuration('每5分钟提醒我喝水，持续时间为20分钟')).toBe(1200)
})
it('rejects mixed calendar and interval rules and malformed clock prefixes', () => {
  expect(() => reminderInterval('每天8点及每周五9点提醒我')).toThrow('多个周期')
  expect(() => reminderInterval('每周五8点，每5分钟提醒我')).toThrow('多个周期')
  expect(reminderAbsoluteTime('117:00提醒我')).toBeUndefined()
  expect(reminderAbsoluteTime('-17:00提醒我')).toBeUndefined()
})
