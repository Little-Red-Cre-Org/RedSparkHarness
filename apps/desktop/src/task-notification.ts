/** Desktop-owned reminders share one window and expire independently. */
import { app, BrowserWindow, screen, nativeImage } from 'electron'
import { join } from 'node:path'

interface TaskNotification { id: string; title: string; body: string; status?: string; time?: number }
interface VisibleNotification { item: TaskNotification; timer?: ReturnType<typeof setTimeout> }
const visible = new Map<string, VisibleNotification>()
let active: BrowserWindow | undefined
let ready = false
let quitting = false

function escape(value: string): string {
  return value.replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

function render(): void {
  const popup = active
  if (!popup || !ready || popup.isDestroyed()) return
  if (!visible.size) { popup.close(); return }
  const area = screen.getPrimaryDisplay().workArea
  const width = Math.min(460, area.width)
  const height = Math.min(240 * visible.size, Math.max(1, area.height - 24))
  popup.setBounds({ x: area.x + Math.max(0, area.width - width - 12), y: area.y + area.height - height - 12, width, height })
  const html = [...visible.values()].reverse().map(({ item }) => {
    const id = escape(encodeURIComponent(item.id))
    const time = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })
      .format(item.time ?? Date.now())
    return `<article><div class="back"></div><div class="card"></div><div class="mascot" aria-hidden="true"></div>
      <div class="copy"><header><b>RedSpark</b> <span>Harness</span><i>✦</i></header>
      <h2 title="${escape(item.title)}">${escape(item.title)}</h2><p title="${escape(item.body)}">${escape(item.body)}</p>
      <div class="meta"><time>${time}</time><span>${escape(item.status ?? '')}</span></div>
      <a class="ack" href="redspark-notice://dismiss/${id}">我知道了</a></div>
      <a class="close" aria-label="关闭提醒" href="redspark-notice://dismiss/${id}">×</a></article>`
  }).join('')
  void popup.webContents.executeJavaScript(`document.body.innerHTML = ${JSON.stringify(html)}`).catch(() => {
    if (!popup.isDestroyed()) popup.close()
  })
  for (const [id, entry] of visible) {
    entry.timer ??= setTimeout(() => { visible.delete(id); render() }, 20000)
  }
}

function open(): void {
  if (active) { render(); return }
  const popup = new BrowserWindow({ width: 460, height: 240, frame: false, transparent: true, hasShadow: false,
    icon: join(app.getAppPath(), 'renderer', 'redspark.png'), title: 'RedSpark Harness', show: false,
    resizable: false, minimizable: false, maximizable: false, alwaysOnTop: true, skipTaskbar: true,
    backgroundColor: '#00000000', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  active = popup
  ready = false
  popup.removeMenu()
  popup.on('closed', () => {
    if (active !== popup) return
    for (const entry of visible.values()) clearTimeout(entry.timer)
    visible.clear(); active = undefined; ready = false
  })
  popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  popup.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    const prefix = 'redspark-notice://dismiss/'
    if (url.startsWith(prefix)) {
      try { showTaskNotification({ dismissId: decodeURIComponent(url.slice(prefix.length)) }) } catch { /* Ignore malformed links. */ }
    }
  })
  popup.once('ready-to-show', () => {
    if (active !== popup || popup.isDestroyed()) return
    void popup.webContents.executeJavaScript(`document.documentElement.style.setProperty('--mascot', ${JSON.stringify(`url("data:image/png;base64,${mascot}")`)})`)
      .catch(() => {})
    ready = true; render()
    if (!popup.isDestroyed()) popup.showInactive()
  })
  const mascot = nativeImage.createFromPath(join(app.getAppPath(), 'renderer', 'task-mascot.png'))
    .resize({ width: 362 }).toPNG().toString('base64')
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
    <style>
    *{box-sizing:border-box}body{margin:0;background:transparent;font:13px "Microsoft YaHei",sans-serif;color:#292329;overflow-y:auto}
    article{height:240px;position:relative;padding:25px 17px 16px 10px;isolation:isolate}
    .back{position:absolute;inset:31px 8px 8px 20px;background:#ce173c;border-radius:14px;z-index:-2}
    .back:after{content:"///";position:absolute;right:20px;bottom:0;color:#fff;font-weight:900;letter-spacing:3px}
    .card{position:absolute;inset:22px 16px 17px 8px;border-radius:14px;background:linear-gradient(120deg,#fff 40%,#fff1f3);
      border:1px solid #f2dfe3;box-shadow:0 3px 12px #46202c19;z-index:-1}
    .card:after{content:"✦";position:absolute;right:22px;top:30px;color:#d51b42;font-size:24px}
    .mascot{position:absolute;right:13px;bottom:18px;width:181px;height:224px;background:var(--mascot) center bottom/contain no-repeat;pointer-events:none}
    .copy{position:relative;width:252px;padding:12px 0 0 17px}header{font-size:12px;display:flex;align-items:center;gap:4px}
    header b{font-size:15px;letter-spacing:-.6px}header span{color:#5c555b}i{color:#ce173c;font-size:20px;font-style:normal;margin-left:3px}
    h2{font-size:21px;line-height:1.3;margin:10px 0 6px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    p{font-size:13px;line-height:1.5;margin:0;height:39px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}
    .meta{display:flex;gap:10px;align-items:center;margin:7px 0 9px;color:#71616a;font-size:11px;white-space:nowrap}
    time{font-variant-numeric:tabular-nums}.ack{display:inline-block;background:#d31c43;color:#fff;padding:7px 23px;border-radius:20px;
      text-decoration:none;font-size:13px;font-weight:600}.ack:hover{background:#b60f34}
    .close{position:absolute;right:24px;top:29px;z-index:2;width:24px;height:24px;text-align:center;line-height:22px;
      font-size:24px;text-decoration:none;color:#50464c;border-radius:50%;background:#fff9}.close:hover{background:#f8dce3}
    a:focus-visible{outline:2px solid #811331;outline-offset:2px}
    @media(max-width:400px){.mascot{width:135px}.copy{width:calc(100% - 125px)}h2{font-size:18px}}
    </style><body></body></html>`
  void popup.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => { if (!popup.isDestroyed()) popup.close() })
}

/**
 * Display authenticated plain-text results immediately, sharing one bounded window.
 * Each reminder expires 20 seconds after display; dismissing one leaves others visible.
 * @param value - Reminder identity, title and body, or an identity to dismiss.
 */
export function showTaskNotification(value: unknown): void {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid task notification')
  const item = value as Partial<TaskNotification>
  if ('dismissId' in value) {
    const id = value.dismissId
    if (typeof id !== 'string' || id.length > 200) throw new Error('Invalid task notification')
    clearTimeout(visible.get(id)?.timer); visible.delete(id)
    if (!visible.size) active?.close()
    else render()
    return
  }
  if (typeof item.id !== 'string' || item.id.length > 200 || typeof item.title !== 'string'
    || item.title.length > 250 || typeof item.body !== 'string' || item.body.length > 2000) throw new Error('Invalid task notification')
  if (item.status !== undefined && (typeof item.status !== 'string' || item.status.length > 100)) throw new Error('Invalid task notification')
  if (item.time !== undefined && (typeof item.time !== 'number' || !Number.isFinite(item.time) || Math.abs(item.time) > 8640000000000000)) throw new Error('Invalid task notification')
  if (quitting) return
  if (!visible.has(item.id) && visible.size >= 20) throw new Error('Task notification limit reached')
  clearTimeout(visible.get(item.id)?.timer)
  visible.set(item.id, { item: { id: item.id, title: item.title, body: item.body,
    ...(item.status === undefined ? {} : { status: item.status }),
    ...(item.time === undefined ? {} : { time: item.time }) } })
  open()
}

app.on('before-quit', () => { quitting = true; active?.destroy() })
