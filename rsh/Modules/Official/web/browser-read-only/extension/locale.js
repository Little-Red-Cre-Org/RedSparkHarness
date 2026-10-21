/** Locale-owned extension UI; page content never supplies labels or markup. */
const en = {
  title: 'RedSpark Harness', subtitle: 'Read authorized pages', connect: 'Connect', authorize: 'Authorize current page',
  disconnect: 'Disconnect', revoke: 'Revoke', connected: 'Connected', disconnected: 'Disconnected', connecting: 'Connecting…',
  privacy: 'Grants apply to the connected Harness. After conversation approval, page text may reach the selected model and its Session log. No clicks, form values or cookies.',
  empty: 'No authorized pages.', ready: 'In Harness, ask to read the authorized browser page.',
  connectFirst: 'Connect to Harness first.', unsupportedPage: 'Open a normal HTTP or HTTPS page first.',
  grantLimit: 'Revoke a page before authorizing another.', pageChanged: 'The page changed. Authorize it again.',
  connectionFailed: 'Cannot connect. Start the browser-enabled Harness profile and check the local host registration.',
  invalidConnection: 'Invalid connection. Reconnect manually.', readOnly: 'Only authorized page reads are supported.',
}
const zh = {
  title: 'RedSpark Harness', subtitle: '读取你授权的网页', connect: '连接', authorize: '授权当前页',
  disconnect: '断开连接', revoke: '撤销', connected: '已连接', disconnected: '未连接', connecting: '连接中…',
  privacy: '授权适用于所连接的 Harness。会话审批通过后，正文可能发送给所选模型并写入该会话记录；不点击网页、不读取表单值或 Cookie。',
  empty: '暂无授权页面。', ready: '在 Harness 中提出“读取已授权的浏览器页面”。',
  connectFirst: '请先连接 Harness。', unsupportedPage: '请先打开普通 HTTP 或 HTTPS 网页。',
  grantLimit: '请先撤销一个页面，再授权其他页面。', pageChanged: '页面已变化，请重新授权。',
  connectionFailed: '无法连接。请启动已启用浏览器功能的 Harness，并检查本地连接组件的注册。',
  invalidConnection: '连接无效，请手动重新连接。', readOnly: '仅支持授权页面只读。',
}
export const messages = chrome.i18n.getUILanguage().startsWith('zh') ? zh : en
