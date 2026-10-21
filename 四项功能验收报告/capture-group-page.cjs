const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { chromium } = createRequire('E:/redsparkHarness/RedSparkHarness-zero-budget-next/package.json')('playwright');
const out = 'E:/redsparkHarness/RedSparkHarness-tool-groups/output/playwright';
(async () => {
  const url = fs.readFileSync(path.join(out, 'tool-groups-server.log'), 'utf8').match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/)[0];
  const sessions = path.join(out, 'tool-groups-home/sessions');
  const saved = fs.readdirSync(sessions, { recursive: true }).filter(file => String(file).endsWith('session.v3.jsonl'))
    .map(file => fs.readFileSync(path.join(sessions, String(file)), 'utf8')).find(text => text.includes('"tool-groups/opened"'));
  const sessionId = JSON.parse(saved.split('\n')[0]).id;
  const browser = await chromium.launch({ headless: true });
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1280, height: 980 }, deviceScaleFactor: 1.5 });
    await page.goto(url);
    await page.getByRole('button', { name: '新建会话', exact: true }).waitFor();
    await page.locator('select').first().selectOption(sessionId);
    await page.locator('textarea').waitFor();
    await page.getByText('离线协议验收完成：先申请 planning 工具组，下一次请求获得 todo_write，再完成清单。本次使用固定模型响应，未调用真实模型。', { exact: true }).waitFor({ timeout: 45000 });
    const text = await page.locator('body').innerText();
    fs.writeFileSync(path.join(out, 'feature03-page.txt'), text);
    await page.screenshot({ path: path.join(out, 'feature03-tool-groups.png'), fullPage: true });
    await page.reload();
    await page.locator('select').first().selectOption(sessionId);
    await page.getByText('离线协议验收完成：先申请 planning 工具组，下一次请求获得 todo_write，再完成清单。本次使用固定模型响应，未调用真实模型。', { exact: true }).waitFor({ timeout: 30000 });
    console.log(JSON.stringify({ page: 'actual Native Web', resultVisible: true, survivesReload: true, screenshot: path.join(out, 'feature03-tool-groups.png') }));
  } catch (error) {
    console.error(error.message);
    if (page && !page.isClosed()) { console.log(await page.locator('body').innerText()); await page.screenshot({ path: path.join(out, 'feature03-diagnostic.png'), fullPage: true }); }
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
