const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const out = __dirname;
const root = 'E:/redsparkHarness';
const reference = 'C:/Users/12148/.codex/visualizations/2026/10/10/01a12514-75c7-74d1-afd6-80766eefc3fc';
const vision = root + '/RedSparkHarness-image-understanding/output/playwright';
const browser = root + '/RedSparkHarness-zero-budget-next/.cache/zero-budget-validation';
const { chromium } = createRequire(root + '/RedSparkHarness-zero-budget-next/package.json')('playwright');
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const stamp = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Macau', hour12: false });
const now = stamp(Date.now());
const shots = {
  reference: reference + '/reference-menu.png',
  selected: reference + '/reference-selected.png',
  guide: reference + '/reference-guide-zh.png',
  browser: browser + '/ide-browser-connected.png',
  popup: browser + '/chrome-authorized.png',
  vision: vision + '/feature01-success.png',
  failure: vision + '/feature01-failure.png',
  groups: root + '/RedSparkHarness-tool-groups/output/playwright/feature03-tool-groups.png',
};
const src = file => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
const figure = (key, caption, extra = '') => `<figure class="${extra}"><a href="#${key === 'groups' ? 'groups' : (({ selected: 'reference', guide: 'reference', popup: 'browser', failure: 'vision' })[key] || key) + '-large'}"><img src="${src(shots[key])}" alt="${esc(caption)}"></a><figcaption>${esc(caption)} · ${stamp(fs.statSync(shots[key]).mtime)}</figcaption></figure>`;
const link = (label, file) => {
  if (!fs.existsSync(file)) throw new Error('Missing evidence: ' + file);
  return `<a href="${esc(pathToFileURL(file).href)}">${esc(label)}</a>`;
};
const observed = JSON.parse(fs.readFileSync(vision + '/feature01-observed.json', 'utf8'));
const groupEvents = fs.readFileSync(root + '/RedSparkHarness-tool-groups/snapshots/native-headless/tool-groups/session.v3.jsonl', 'utf8')
  .trim().split('\n').map(line => JSON.parse(line));
const opened = groupEvents.find(event => event.type === 'tool-groups/opened');
if (!opened) throw new Error('Missing durable tool-group grant');
const groupExample = JSON.stringify({ type: opened.type, group: opened.data.group, tools: opened.data.tools }, null, 2);
const css = `
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f1f2f5;color:#252936;font-family:'Microsoft YaHei','Segoe UI',sans-serif;font-size:17px;line-height:1.7}main{max-width:1320px;margin:auto;background:#fff;padding:42px 48px}h1,h2,h3,p{margin:0}h1{font-size:40px;line-height:1.3;margin:12px 0}h2{font-size:28px;margin:10px 0 18px}h3{font-size:21px;margin-bottom:10px}p+p{margin-top:10px}a{color:#9a3156}small,.muted,figcaption{color:#626a78}code,pre{font-family:Consolas,'Microsoft YaHei',monospace}code{overflow-wrap:anywhere}pre{white-space:pre-wrap;background:#f3f5f8;border:1px solid #dce1e9;border-radius:10px;padding:18px;font-size:15px;line-height:1.6}table{border-collapse:collapse;width:100%;font-size:16px;margin:18px 0}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #dce1e9;padding:12px}th{background:#f3f5f8}.kicker{font-size:14px;letter-spacing:2px;color:#9a3156;font-weight:bold}.notice{background:#fff3dd;border-left:5px solid #c98c25;padding:18px 22px;border-radius:9px;margin:20px 0}.good{color:#256a52;background:#e9f5ee}.pending{color:#805215;background:#fff0d8}.badge{display:inline-block;font-size:14px;font-weight:bold;border-radius:20px;padding:3px 12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.card{border:1px solid #dce1e9;border-radius:12px;padding:20px;break-inside:avoid}.card h3{margin-bottom:5px}.card p{font-size:16px}.card figure{margin-top:14px}figure{margin:0}figure img{display:block;width:100%;height:auto;border:1px solid #dce1e9;border-radius:7px}figcaption{font-size:13px;margin-top:7px;line-height:1.5}.card .thumb img{height:220px;object-fit:contain;background:#fafafa}.card pre{font-size:14px;min-height:220px;margin:14px 0 0}.section{padding-top:32px;margin-top:32px;border-top:1px solid #dce1e9}.section>p{margin-bottom:14px}.section figure{margin:20px 0}.twocol{display:grid;grid-template-columns:1fr 1fr;gap:18px}.popup{max-width:420px}.footer{font-size:14px;color:#626a78;margin-top:28px}.flow{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:18px 0}.flow span{background:#f3f5f8;border-radius:7px;padding:9px 13px}ul{padding-left:24px}li{margin:7px 0}.evidence li{font-size:15px}nav{display:flex;gap:18px;flex-wrap:wrap;margin:20px 0}.small{font-size:14px}.status{font-weight:bold}.wide{overflow-wrap:anywhere}@media(max-width:800px){main{padding:24px 18px}.grid,.twocol{grid-template-columns:1fr}h1{font-size:31px}table{font-size:14px}th,td{padding:8px}}@media print{body{background:#fff}main{max-width:none;padding:0}.section{break-before:page}nav{display:none}a{color:inherit}figure{break-inside:avoid}}
`;
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RSH 四项功能首版验收报告</title><style>${css}</style></head><body><main>
<div id="overview">
<div class="kicker">REDSPARK HARNESS · 本地开发与验收</div>
<h1>四项功能首版验收报告</h1>
<p class="muted">更新于 ${now}（Asia/Macau） · 独立功能分支 · 未合并、未部署</p>
<div class="notice"><strong>四项首版代码已实现，但最终验收尚未全部完成。</strong><br>2026-10-10 必要复测 38 项通过、1 项既有跳过。2026-10-11 Chrome 弹窗复验仍无响应，不能用旧通过记录替代；验收脚本已增加请求超时与独立清理。图片转接仍未验证真实视觉模型，四项统一桌面集成及部分完整检查仍待完成。下方页面图片为标注日期的历史真实截图。</div>
<table><thead><tr><th>功能</th><th>实际做了什么</th><th>当前结论</th></tr></thead><tbody>
<tr><td>文件引用与中文指南</td><td>@ 文件／目录／会话引用；离线指南；修复退出阻塞</td><td><span class="badge good">本地验收通过</span><br>6 个浏览器场景，35 项文档检查分次通过</td></tr>
<tr><td>01 图片理解转接</td><td>视觉模型读图后交回文本主模型；保留原图；支持追问</td><td><span class="badge pending">离线流程通过</span><br>真实视觉模型与完整验收仍待完成</td></tr>
<tr><td>02 浏览器只读</td><td>逐页授权、只读正文、来源记录、撤销与断连</td><td><span class="badge pending">Chrome 复验未通过</span><br>核心与 CLI 曾通过；弹窗故障仍未关闭</td></tr>
<tr><td>03 按需开放工具组</td><td>申请工具组，下一次模型请求生效；保留权限检查</td><td><span class="badge pending">CLI / Web 流程通过</span><br>真实截图已补；完整 Host 汇总检查受内存限制</td></tr>
</tbody></table>
<div class="grid">
<article class="card"><h3>文件引用：现有会话输入框</h3><p>输入 @ 后选择文件，显示引用标签。复用现有界面。</p>${figure('reference', '真实 Web 页面；测试语言为英文；未调用模型', 'thumb')}</article>
<article class="card"><h3>图片转接：现有添加图片入口</h3><p>文本主模型保留，视觉观察以文本交回。无独立设置页。</p>${figure('vision', '真实 Native Web 页面；使用离线固定响应替身', 'thumb')}</article>
<article class="card"><h3>浏览器只读：扩展与会话结果</h3><p>Chrome 中授权，RSH 中审批并查看正文与网址。</p>${figure('browser', '真实 Native IDE 截图；同日既有离线验收证据', 'thumb')}</article>
<article class="card"><h3>工具组：现有会话与任务列表</h3><p>先申请 planning，再调用 todo_write。刷新后重新选择会话可恢复结果。</p>${figure('groups', '真实 Native Web 页面；固定响应模型，本轮已操作验证', 'thumb')}</article>
</div>
<p class="footer">以上图片来自实际运行，不是设计效果图。截图中的离线替身不能证明真实模型识别质量、延迟或费用。完整报告包含放大图片、预期对照、使用入口及遗留问题。</p>
</div>
<nav><a href="#reference-large">文件引用</a><a href="#vision-large">图片转接</a><a href="#browser-large">浏览器只读</a><a href="#groups">工具开放</a><a href="#remaining">未关闭项目</a><a href="#evidence">证据与分支</a></nav>
<section class="section" id="reference-large"><h2>文件引用与离线中文指南</h2><p><strong>怎么用：</strong>打开 Web 会话，选择工作区，在输入框键入 @，选择文件、文件夹或会话。中文指南从文档站入门目录进入，也可直接离线阅读 Markdown。</p>
<table><tr><th>预期</th><th>实际验证</th><th>是否达到</th></tr><tr><td>选择与插入引用、目录展开和会话顺序正确</td><td>6 个真实浏览器场景通过，Host 正常退出</td><td>本地达标</td></tr><tr><td>中文和空格路径正确；指南可读</td><td>定向测试 41 通过、1 跳过；文档 35 项逐项通过</td><td>本地达标</td></tr><tr><td>模型理解文件、Native IDE 内嵌入口</td><td>本轮没有真实模型与独立 Native IDE 验证</td><td>未验证</td></tr></table>
${figure('reference', '实际引用菜单，不是新增侧栏页面')}${figure('selected', '选中文件后的输入标签，尚未发送模型请求')}${figure('guide', '中文指南的真实页面渲染')}
<p>已修复 Host 测试误入客户端编译、设置子路径缺少源码映射、断连后响应等待导致退出超时的问题。功能复用已有 Web 路径，不代表整个 IDE 或全项目 Native 迁移完成。</p></section>
<section class="section" id="vision-large"><h2>功能01 图片理解转接</h2><p><strong>怎么用：</strong>在 Native Host profile 明确配置一个支持图片的视觉模型，再从现有“添加图片 → 发送”入口使用；read_image 共用转接服务。没有新增独立功能页，不会自动选择收费模型。</p>
<div class="flow"><span>图片 + 当前问题</span>→<span>视觉模型理解</span>→<span>记录原图、观察与用量</span>→<span>原文本主模型继续回答</span></div>
<table><tr><th>预期</th><th>实际验证</th><th>是否达到</th></tr><tr><td>转接后主模型保持不变，不向文本主模型发送图片块</td><td>真实页面记录路由 ${esc(observed.models.join(' → '))}；主模型图片块数 ${esc(observed.primaryImageCounts.join(', '))}</td><td>离线流程达标</td></tr><tr><td>保留原图并允许具体问题追问</td><td>原始图片事件保留；已有追问用例经 run_code 验证，4 项目标用例通过</td><td>离线流程达标</td></tr><tr><td>失败明确提示，不让主模型假装已看图</td><td>页面显示视觉失败，失败轮没有继续调用主模型；错误持久化</td><td>达标</td></tr><tr><td>真实图片识别准确、延迟与费用可接受</td><td>未选择、未调用真实视觉模型</td><td>未验证</td></tr></table>
${figure('vision', '实际成功页面；模型是离线替身，输入为测试图片')}${figure('failure', '实际失败页面；上方旧成功回复属于上一轮，失败轮未生成新答案')}
<p>实现位于 <code>rsh/Modules/Official/image/image-understanding</code>，使用 NativePlugin。监督中已纠正原先集中在 Engine 的实现方式，并修复追问工具缺少 canonical output schema 导致 run_code 不兼容的问题。Engine 仅保留能力接口和必要接点。</p>
<p class="muted">70 项受影响测试曾通过；最终 4 个图片场景通过。相关类型、构建、lint 通过；本轮补齐一个真实 CLI 录制／回放场景，独立回放通过；86 个文档代码块检查通过；网站构建、190 个页面渲染和 2,718 个内部片段链接通过。完整 doc-sync 仍未全部完成，不能当作最终全绿。</p></section>
<section class="section" id="browser-large"><h2>功能02 本机浏览器只读</h2><p><strong>怎么用：</strong>启动配置好的 Native Host，加载 Chrome 扩展，在目标页面点击“连接 → 授权当前页”，回到 RSH 发送读取请求并批准本次读取。查看标题、网址和正文，用完撤销或断开。</p>
<table><tr><th>预期</th><th>实际验证</th><th>是否达到</th></tr><tr><td>只读授权页面、保留来源</td><td>10 月 10 日曾通过；10 月 11 日弹窗无响应，未完成读取复验</td><td>当前验收未关闭</td></tr><tr><td>不点击、不输入、不提交</td><td>历史记录 DOM 未改变、写请求为 0，表单与隐藏文本被排除；本轮没有重复达到此阶段</td><td>仅历史证据</td></tr><tr><td>撤销、导航与断连后停止读取</td><td>核心生命周期和 CLI 复测通过；当前真实 Chrome 弹窗复验失败</td><td>部分验证</td></tr><tr><td>日常桌面入口默认可用</td><td>当前为可选功能配置，未部署到日常快捷方式</td><td>尚未部署</td></tr></table>
${figure('popup', 'Chrome 扩展逐页授权弹窗', 'popup')}${figure('browser', 'IDE 中的审批后来源结果；此图是 16:24 的既有证据，本监督轮只复核图片')}
<p>没有独立 RSH 功能页面；使用扩展弹窗和现有会话工具结果。仅处理顶层网页文字，不支持 PDF、图片、iframe、影子根或网页交互。原临时桌面验收配置已不在原路径，不能声称旧脚本现在可直接启动。</p>
<p>${link('浏览器详细配置与图片报告', root + '/RSH-feature/功能02交付材料/功能02报告说明.html')}</p></section>
<section class="section" id="groups"><h2>功能03 按需开放工具组</h2><p><strong>怎么用：</strong>在 Native profile 安装官方 tool-groups 插件，配置 initial 与 groups，并设置 builtinTools: false。模型先看到基础工具与组目录，需要时申请组；下一次模型请求才开放。默认 profile 不自动启用。</p>
<div class="flow"><span>基础工具 + 组目录</span>→<span>request_tool_group</span>→<span>记录开放状态</span>→<span>下一轮可用，权限仍检查</span></div>
<table><tr><th>预期</th><th>实际验证</th><th>是否达到</th></tr><tr><td>不能在申请同批次提前使用新工具</td><td>普通调用、程序调用及下一轮开放的定向用例通过</td><td>CLI / 组合测试达标</td></tr><tr><td>恢复状态、任务隔离、不绕过权限</td><td>冷/热恢复、guard、任务隔离验证通过</td><td>达标</td></tr><tr><td>减少模型费用或提高成功率</td><td>没有真实模型性能与费用对照</td><td>未验证，不承诺收益</td></tr><tr><td>页面展示与持久会话</td><td>真实 Native Web 显示申请工具组、调用 todo_write 和完成清单；刷新后重新选择会话仍可查看</td><td>Web 达标；桌面整合未验证</td></tr></table>
${figure('groups', '实际操作后的 Native Web 页面，使用离线固定响应模型')}<pre>${esc(groupExample)}</pre><p class="muted">事件数据来自真实 CLI 离线回放的 Session 记录。页面与 CLI 记录分别提供可见效果和执行证据。前端复用源码逐文件一致的既有构建，Host 使用本分支源码。最终功能与目录测试 12 项通过；297 个依赖项目逐包编译通过；完整 Host 汇总类型检查仍因内存分配失败未通过，保留失败日志。</p></section>
<section class="section" id="remaining"><h2>仍未关闭的验收项目</h2><ul><li><strong>真实视觉模型：</strong>需明确可用提供方、模型和额度，再验证真实图片识别、延迟及费用。没有把替身的 usage 数字当作真实计费。</li><li><strong>完整检查：</strong>图片功能的完整 doc-sync，以及工具组完整 Host 汇总类型检查仍有缺口；图片仓库级 CLI 回放已经通过。基线 GitHub webhook 场景的登记与 profile 分类已修正，图片和工具组分支各三项全库快照校验通过；内存／页面文件不足的失败记录保留。</li><li><strong>桌面与统一入口：</strong>工具组已补真实 Native Web 页面验收，尚未做 Electron 桌面整合；四项目前分属独立 worktree，未做合并后的统一日常版本联验。</li><li><strong>交付到日常版本：</strong>未提交、未合并 main、未部署。该报告不授权合并、发布、配置收费模型或增加范围。</li></ul>
<h3>本轮监督实际处理的问题</h3><ul><li>推动图片转接由 Engine 内置实现改为官方 NativePlugin；独立检查代码落点。</li><li>复现并修复 understand_image 缺少规范输出造成的 run_code 兼容故障；复用原追问用例验证，无新增用例。</li><li>发现文件引用任务首轮曾在 main 添加 8 行网站导航，已仅撤回这项已确认归属的改动，并验证该文件相对 HEAD 无差异。不能说 main 从未被这些任务碰过。</li><li>两次只读扫描主目录 362 个依赖目录，未发现指向三个新功能工作树的依赖链接；其他既有主目录改动和会话均保留。</li></ul></section>
<section class="section" id="evidence"><h2>分支与证据</h2><table><tr><th>功能</th><th>分支 / 工作树</th><th>详细记录</th></tr>
<tr><td>文件引用与指南</td><td class="wide"><code>codex/reference-acceptance</code><br>RedSparkHarness-reference-acceptance</td><td>${link('验收记录与日志索引', reference + '/验收记录.md')}</td></tr>
<tr><td>图片理解转接</td><td class="wide"><code>codex/feature01-image-understanding</code><br>RedSparkHarness-image-understanding</td><td>${link('阶段验收', vision + '/功能01-阶段验收.md')} · ${link('实际观察 JSON', vision + '/feature01-observed.json')}</td></tr>
<tr><td>浏览器只读</td><td class="wide"><code>codex/zero-budget-next</code><br>RedSparkHarness-zero-budget-next</td><td>${link('本地验收记录', root + '/RSH-feature/功能02-浏览器只读接入验收收尾-2026-10-10.md')}</td></tr>
<tr><td>工具组</td><td class="wide"><code>codex/feature03-tool-groups</code><br>RedSparkHarness-tool-groups</td><td>${link('实现与验证记录', root + '/RSH-feature/功能03-按需工具组-实现记录.md')}</td></tr></table>
<p>${link('监督记录与修复过程', root + '/RSH-feature/监督记录.md')} · ${link('后续开发约定', root + '/RSH-feature/AGENTS.md')}</p>
<p class="footer">本报告图片已内嵌，可离线阅读。详细日志链接指向本机真实文件。报告是当前首版开发与验收状态，不是“全部最终验收通过”的证明。源代码与截图来源以各项记录为准。</p></section>
</main></body></html>`;

const report = path.join(out, 'RSH-四项功能首版验收报告.html');
fs.writeFileSync(report, html);
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1420, height: 1000 }, deviceScaleFactor: 1.5 });
    await page.goto(pathToFileURL(report).href);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    const checks = await page.evaluate(() => ({ title: document.title, images: document.images.length,
      broken: [...document.images].filter(image => !image.complete || !image.naturalWidth).length,
      overflow: document.documentElement.scrollWidth > innerWidth,
      missingAnchors: [...document.querySelectorAll('a[href^="#"]')].map(a => a.hash.slice(1)).filter(id => !document.getElementById(id)),
    }));
    if (checks.broken || checks.overflow || checks.missingAnchors.length) throw new Error(JSON.stringify(checks));
    await page.locator('#overview').screenshot({ path: path.join(out, 'RSH-四项功能验收总览.png') });
    console.log(JSON.stringify({ report, overview: path.join(out, 'RSH-四项功能验收总览.png'), checks }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
