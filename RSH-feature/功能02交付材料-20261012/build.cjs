const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {pathToFileURL} = require('node:url');
const root='E:/redsparkHarness/RedSparkHarness-zero-budget-next';
const {chromium}=createRequire(root+'/package.json')('playwright');
const out=__dirname;
const img=n=>'data:image/png;base64,'+fs.readFileSync(root+'/.cache/zero-budget-validation/'+n).toString('base64');
const popup=img('chrome-authorized.png'), approval=img('ide-browser-approval.png'), result=img('ide-browser-connected.png');
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const code=s=>'<pre><code>'+esc(s)+'</code></pre>';
const css=`*{box-sizing:border-box}body{margin:0;color:#252331;background:#eeedf2;font-family:'Microsoft YaHei','Segoe UI',sans-serif;line-height:1.65}h1,h2,h3,p{margin:0}h1{line-height:1.25}h2{line-height:1.4}p+p{margin-top:12px}small,.muted{color:#6c6874}code{font-family:Consolas,'Microsoft YaHei',monospace}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f1f5;border:1px solid #dedbe4;border-radius:10px;padding:18px;font-size:14px;line-height:1.65}table{width:100%;border-collapse:collapse}td,th{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #ddd}th{background:#f1edf3}a{color:#90325a}img{max-width:100%;display:block}figure{margin:0}figcaption{font-size:14px;color:#6c6874;margin:10px 0 20px}.tag{display:inline-block;background:#e5f2ec;color:#276247;border-radius:100px;padding:6px 16px;font-weight:700}.notice{background:#fff1dc;border-left:5px solid #d99b3d;padding:18px 22px;border-radius:8px}.section{margin-top:30px}.kicker{letter-spacing:3px;font-size:17px;color:#9a4065;font-weight:700}.grid{display:grid;gap:20px}.card{background:white;border:1px solid #e2dce7;border-radius:16px;padding:24px}.num{color:#a33b65;font-weight:800}.shot{border:1px solid #d9d3df;border-radius:10px;overflow:hidden;background:#fff}.caption{font-size:17px;color:#6d6675;margin-top:10px}`;
const poster=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>功能02 浏览器只读接入总览</title><style>${css}
body{width:1600px;background:#f6f3f6}main{padding:58px 64px 42px}h1{font-size:58px;margin:12px 0 20px}h2{font-size:32px;margin-bottom:18px}h3{font-size:24px;margin-bottom:8px}p{font-size:22px}.hero{display:flex;justify-content:space-between;align-items:center}.tag{font-size:22px}.section{margin-top:34px}.card p{font-size:21px}.note{font-size:20px;color:#6d6675}.shots{grid-template-columns:390px 1fr}.popup{width:370px;margin:auto}.result img{width:100%}.approval{height:240px;position:relative;margin-top:17px}.approval img{max-width:none;width:1536px;position:absolute;left:-418px;top:-607px}.flow{grid-template-columns:repeat(4,1fr)}.flow .num{font-size:40px}.flow p{font-size:21px}.open{background:#292333;color:white;border-radius:18px;padding:28px 32px}.open p{font-size:22px}.open .note{color:#d8cbdc}footer{margin-top:28px;font-size:17px;color:#736a78;border-top:1px solid #d9d2dd;padding-top:16px}
</style><main>
<div class="hero"><span class="kicker">REDSPARK HARNESS · 功能 02</span><span class="tag">已完成三项细节修复</span></div>
<h1>浏览器只读接入<br>完成了什么，如何打开与使用</h1>
<p>让 RSH 读取你明确授权的网页正文，并在会话中保留标题、网址与来源文本。</p>
<div class="notice section"><p><b>当前是功能分支版本，尚未部署到日常快捷方式。</b><br>以下界面来自 10 月 10 日真实验收；10 月 12 日 Chrome 复验调试超时，未完成。</p></div>
<section class="section"><h2><span class="num">01</span> 已完成的能力</h2><div class="grid" style="grid-template-columns:repeat(3,1fr)">
<div class="card"><h3>逐页授权与只读提取</h3><p>Chrome 扩展连接、授权、撤销。读取标题、网址和顶层正文；排除表单值与隐藏文本。</p></div>
<div class="card"><h3>会话审批与来源记录</h3><p>browser_tabs 列出授权页面，browser_read 请求审批。来源和读取结果写入同一会话。</p></div>
<div class="card"><h3>失效与清理已验证</h3><p>撤销、刷新、断连后失效；取消、超时和停止清理通过。真实测试 DOM 不变、写请求为 0。</p></div>
</div></section>
<section class="section"><h2>10 月 12 日优化了什么</h2><div class="grid" style="grid-template-columns:repeat(3,1fr)"><div class="card"><h3>消息不再误判超限</h3><p>按单条消息计算大小，正确处理消息合并与分段到达。</p></div><div class="card"><h3>点击与键盘焦点稳定</h3><p>轮询期间的操作按顺序执行；未变化的列表不重建按钮。</p></div><div class="card"><h3>重新授权更准确</h3><p>验证成功才替换原授权；提交时复核并发授权数量。</p></div></div></section><section class="section"><h2><span class="num">02</span> 真实界面长这样</h2><div class="grid shots">
<div><h3>A · Chrome 授权弹窗</h3><div class="shot popup"><img src="${popup}"></div><p class="caption">2026-10-10 17:12:32<br>真实 Chrome 154 · 本地测试页</p><div class="card" style="padding:18px;margin-top:16px"><p>在这里点击<br><b>连接 → 授权当前页</b><br>停止读取：撤销／断开连接</p></div></div>
<div><h3>B · IDE 内的会话结果</h3><div class="shot result"><img src="${result}"></div><p class="caption">2026-10-10 16:24:36 · Native IDE 验收版 · 离线模型 fixture</p></div>
</div><div class="grid" style="grid-template-columns:620px 1fr;align-items:center;margin-top:6px"><div class="shot approval"><img src="${approval}"></div><div><h3>C · 读取前由你批准</h3><p>会话出现工具审批，点击“允许一次”或“拒绝”。</p><p class="caption">真实审批截图局部 · 2026-10-10 16:24:36</p></div></div></section>
<section class="section open"><h2><span style="color:#ef9bbc">03</span> 怎么打开</h2><p><b>首次：</b>配置 Native 会话 Host → 注册 Chrome 本地连接 → 加载已解压扩展。</p><p><b>以后：</b>启动同一 Host → 打开普通网页 → 点扩展图标或 <b>Alt+Shift+R</b>。</p><p class="note" style="margin-top:12px">不是独立功能页面。已配置的 Native Desktop 可从空闲会话点“在 IDE 中打开”。<br>完整路径、命令和配置示例见配套报告；旧临时桌面验收配置当前不在原路径。</p></section>
<section class="section"><h2><span class="num">04</span> 每次使用的四个步骤</h2><div class="grid flow">
<div class="card"><div class="num">1</div><h3>连接并授权</h3><p>打开目标网页，在 Chrome 扩展中点击“连接”和“授权当前页”。</p></div>
<div class="card"><div class="num">2</div><h3>发送读取请求</h3><p>在 RSH 输入：“读取已授权的浏览器页面，并引用来源网址。”</p></div>
<div class="card"><div class="num">3</div><h3>批准并查看</h3><p>点击“允许一次”。展开 browser_read，查看标题、网址和正文。</p></div>
<div class="card"><div class="num">4</div><h3>用完撤销</h3><p>在扩展中点“撤销”或“断开连接”。导航、刷新后需重新授权。</p></div>
</div></section>
<div class="notice section"><p><b>范围：</b>不点击、不输入、不提交；不读取 Cookie、PDF、图片、iframe 或影子根。<br>撤销不会删除已保存的会话结果。连接组件无需订阅，真实模型推理可能收费。</p></div>
<footer>10 月 12 日：定向测试 6 项、会话快照 1 项、构建、定向 lint 与双语配对检查通过。<br>新增测试用例已按要求删除；Chrome 复验未完成；真实模型未验。<br>工作分支 codex/zero-budget-next · 基线 878d740a · 更新于 2026-10-12 · 配套文件：功能02报告说明.html</footer>
</main></html>`;
const setup1=String.raw`Set-Location 'E:\redsparkHarness\RedSparkHarness-zero-budget-next'
$env:DSH_HOME = Join-Path $env:LOCALAPPDATA 'RedSparkHarness\browser-read-only-trial'
pnpm dsh --profile native-web`;
const setup2=String.raw`Set-Location (Join-Path $env:DSH_HOME 'profiles\native-web')
pnpm add 'link:E:/redsparkHarness/RedSparkHarness-zero-budget-next/rsh/Modules/Official/web/browser-read-only'`;
const config=JSON.stringify({id:'browser-read-only',plugin:'@deepseek-ai/dsh-browser-read-only',scope:'root',config:{connectionFile:'C:/Users/12148/AppData/Local/RedSparkHarness/browser-read-only/connection.json'}},null,2);
const register=String.raw`Set-Location 'E:\redsparkHarness\RedSparkHarness-zero-budget-next'
$connectionFile = Join-Path $env:LOCALAPPDATA 'RedSparkHarness\browser-read-only\connection.json'
& '.\rsh\Modules\Official\web\browser-read-only\scripts\register-chrome.ps1' -ConnectionFile $connectionFile`;
const extension='E:\\redsparkHarness\\RedSparkHarness-zero-budget-next\\rsh\\Modules\\Official\\web\\browser-read-only\\extension'.replaceAll('\\\\','\\');
const report=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>功能02 浏览器只读接入报告说明</title><style>${css}
main{max-width:1100px;margin:32px auto;background:white;padding:54px 60px;border-radius:16px}h1{font-size:38px;margin:12px 0 18px}h2{font-size:27px;margin:34px 0 16px}h3{font-size:20px;margin:24px 0 10px}p,li,td{font-size:16px}li{margin-bottom:10px}nav{padding:20px;background:#f5f0f5;border-radius:10px;margin:24px 0}nav a{margin-right:20px}.two{grid-template-columns:340px 1fr;align-items:start}figure img{border:1px solid #ded8e1;border-radius:8px}details{border:1px solid #ddd;border-radius:8px;padding:16px;margin-top:14px}summary{cursor:pointer;font-weight:bold}.print{float:right;padding:10px 18px;border:0;border-radius:8px;background:#78334e;color:#fff;cursor:pointer}@media(max-width:800px){main{padding:24px;margin:0}.two{grid-template-columns:1fr}h1{font-size:30px}table{display:block;overflow:auto}}@media print{body{background:#fff}main{margin:0;padding:0;max-width:none}.print,nav{display:none}h2,h3{break-after:avoid}tr,figure,pre,.notice{break-inside:avoid}a{color:inherit}details{display:block}@page{size:A4;margin:18mm}}
</style><main><button class="print" onclick="window.print()">打印 / 另存为 PDF</button><div class="kicker">REDSPARK HARNESS · 更新于 2026-10-12</div><h1>功能02 浏览器只读接入报告说明</h1>
<p>功能02让 RSH 读取你在 Chrome 中明确授权的网页，将标题、网址和正文作为来源资料加入会话。本报告说明实际完成范围、真实界面、首次配置、日常操作，以及测试证据与交付边界。</p>
<div class="notice section"><b>结论：三项细节修复及定向检查完成；真实 Chrome 复验未完成，尚未提交、合并或部署日常版本。</b><p>当前没有可直接从日常快捷方式打开的浏览器功能入口。IDE 截图来自10月10日完成的离线验收；当前复核发现旧验收启动脚本依赖的临时桌面配置已不在原路径，因此旧脚本不能作为现成入口。下文提供源码版本支持的 Native profile 配置方式。</p></div>
<nav><a href="#status">完成了什么</a><a href="#ui">界面是什么</a><a href="#open">怎么打开</a><a href="#use">怎么使用</a><a href="#test">测试与限制</a></nav>
<h2 id="status">一 完成范围与交付状态</h2><table><tr><th>项目</th><th>当前状态</th><th>入口或边界</th></tr>
<tr><td>Chrome 逐页授权</td><td>已实现；10月10日通过，10月12日复验未完成</td><td>扩展弹窗：连接、授权当前页、撤销、断开连接</td></tr>
<tr><td>会话工具</td><td>已实现，离线快照通过</td><td>browser_tabs 列出已授权页面；browser_read 经会话审批读取</td></tr>
<tr><td>来源与历史</td><td>已实现，持久化和冷读取通过</td><td>标题、URL、正文与截断标记写入 Session；撤销错误也记录</td></tr>
<tr><td>IDE 界面链路</td><td>10月10日既有真实验收通过，10月12日未重跑</td><td>Native Desktop 空闲会话 → 在 IDE 中打开</td></tr>
<tr><td>提交 合并 部署</td><td>均未完成</td><td>仍在功能 worktree；不会自动出现在日常版本</td></tr>
<tr><td>真实模型效果</td><td>未验证</td><td>验收使用 offline fixture，无本地真实模型或云端真实模型推理</td></tr></table>
<p class="section">实现采用 Native Runtime / NativePlugin，包位于 <code>rsh/Modules/Official/web/browser-read-only</code>。浏览器扩展通过 Native Messaging 和需认证的本地管道连接 Host，复用现有工具注册、会话审批及 Session 写入方；新增模块没有引入 Cordis 桥接。</p>
<pre>工作目录：E:/redsparkHarness/RedSparkHarness-zero-budget-next
分支：codex/zero-budget-next
基线：878d740a
状态：已有代码和集成改动尚未提交；此目录还含其他功能改动。</pre>
<h3>10月12日新增修复</h3><table><tr><th>问题</th><th>实际改动</th></tr><tr><td>多个合法消息合并到达时被误判超限</td><td>1 MiB 限制按单条消息计算；按帧缓冲，支持分段帧头、正文及连续消息。</td></tr><tr><td>弹窗轮询可能忽略点击并丢失键盘焦点</td><td>用户操作排在进行中的请求之后；授权列表不变时保留现有按钮。</td></tr><tr><td>重新授权过早撤销原授权，并发数量检查过早</td><td>文档验证成功才替换授权；在提交时复核当前授权数量。</td></tr></table><p class="section">仅修改浏览器包的 src/wire.ts、extension/popup.js、extension/background.js 及相关文档，没有新增依赖、配置开关或框架。上述修复不改变下方界面布局与按钮入口。</p><h2 id="ui">二 真实界面与入口</h2><p>此功能没有独立管理页面。你会接触两个地方：Chrome 的扩展弹窗，以及 RSH 的现有会话与工具审批界面。下列均为实际验收截图，不是设计效果图。</p>
<div class="grid two section"><figure><img src="${popup}"><figcaption>图1 Chrome 授权弹窗<br>2026-10-10 17:12:32，Windows，Chrome/154.0.8037.99，本机测试网页。</figcaption></figure><div><h3>Chrome 弹窗中的按钮</h3><ul><li><b>连接：</b>连接已运行且已安装浏览器模块的 Harness Host。</li><li><b>授权当前页：</b>为当前网页创建授权。仅列出授权页面，不列出所有标签页。</li><li><b>撤销：</b>撤销该页面授权，后续读取将拒绝。</li><li><b>断开连接：</b>清除全部授权。下次连接后需要重新授权。</li></ul><p>图中 localhost 地址是验收网页，不是打开 RSH 的固定地址。不要复制它作为应用入口。</p></div></div>
<figure><img src="${approval}"><figcaption>图2 IDE 内的读取审批，2026-10-10 16:24:36。Native IDE 验收配置，模型为 fixture；点击“允许一次”或“拒绝”。截图上方的工作区受限模式提示属于 IDE。</figcaption></figure>
<figure><img src="${result}"><figcaption>图3 browser_read 成功结果，2026-10-10 16:24:36。展示来源标题、URL、正文及 truncated 标记；下方回复由离线测试模型生成，不能用来判断真实模型理解质量。</figcaption></figure>
<h2 id="open">三 首次配置与打开方式</h2><p>下列步骤面向这个功能分支的已构建源码版本，需要 Node.js、pnpm 和 Windows Chrome。配置步骤依据随包中文指南整理；它们不是本次新执行的日常安装记录。本次交付仅生成说明材料，没有注册你的日常 Chrome，也没有修改默认 profile。</p>
<h3>1 创建独立 Native 会话配置</h3><p>在 PowerShell 中执行以下命令。使用单独的 DSH_HOME，以便与日常会话数据分开。首次启动创建 profile 后，用 Ctrl+C 停止该实例，再进行下一步。</p>${code(setup1)}
<p>若提示已有程序包尚未构建，应先完成对应源码构建。浏览器包的构建命令如下；这两条只负责浏览器包，不代替整个桌面应用构建。</p>${code(String.raw`pnpm exec tsc -b rsh/Modules/Official/web/browser-read-only
pnpm --dir rsh/Modules/Official/web/browser-read-only exec tsdown`)}
<h3>2 在会话 Host 中安装浏览器模块</h3><p>仍在同一个 PowerShell 窗口执行：</p>${code(setup2)}
<p>打开 <code>$env:DSH_HOME/profiles/native-web/rsh.profile.json</code>，在现有 <code>installations</code> 数组中加入下面这个对象，保留其他条目并正确处理逗号。不要用这个对象覆盖整个配置文件。</p>${code(config)}
<p>路径示例对应当前 Windows 用户 12148；若运行账号不同，请替换为该账号的私有本地应用数据目录。保留现有工具、审批服务与会话应答方。模块应装在会话 Host 的 profile 中，不要仅加入独立的 native-ide 编辑器 profile，也不要写入 cordis.yml。</p>
<h3>3 启动同一个 Host 并注册 Chrome 连接</h3><p>返回源码根目录，在保留上述 DSH_HOME 的 PowerShell 窗口中启动：</p>${code(String.raw`Set-Location 'E:\redsparkHarness\RedSparkHarness-zero-budget-next'
pnpm dsh --profile native-web`)}
<p>按终端实际输出打开应用地址，不使用截图中的测试端口。会话使用的真实模型与凭据需在该独立配置中按现有模型设置完成；不要把离线 fixture 当成日常模型。</p><p>保持 Host 运行，在另一个 PowerShell 窗口执行：</p>${code(register)}
<p>注册命令的 connectionFile 必须与第2步一致。连接文件含本地认证令牌，保存在用户私有目录，不复制到对话或截图中。已存在其他安装的注册项时，脚本会拒绝覆盖，应先按其原安装方式处理。</p>
<h3>4 在 Chrome 加载扩展</h3><ol><li>打开 <code>chrome://extensions</code>。</li><li>开启“开发者模式”，点击“加载已解压的扩展程序”。</li><li>选择下方目录，确认扩展名为 <b>RedSpark Harness Read Only</b>。</li><li>将扩展固定到工具栏。打开普通 HTTP 或 HTTPS 网页，点击扩展图标，或使用建议快捷键 <b>Alt+Shift+R</b>。</li></ol>${code(extension)}
<h3>5 如果要在 IDE 内使用</h3><p>先为 Native Desktop 的会话 Host 安装同一浏览器模块，再从空闲会话点击“在 IDE 中打开”。IDE 内的嵌入会话复用该 Host 的审批和 Session。独立 native-web 的配置不会自动转换日常 Desktop，也不会自动生成截图中的 IDE 桌面环境。</p><p>原验收脚本 <code>.cache/zero-budget-validation/launch-native-desktop.cjs</code> 仍存在，但其所依赖的 <code>rsh/Programs/Desktop/.desktop-build/development/project/rsh.profile.json</code> 当前不存在。若要恢复相同桌面演示环境，需要重新准备验收配置；不应直接把该脚本作为用户启动入口。</p>
<h2 id="use">四 每次如何使用</h2><ol><li><b>启动：</b>启动安装了浏览器模块的同一 Native Host。若新开 PowerShell，需要重新设置前述 DSH_HOME。</li><li><b>授权：</b>在 Chrome 打开目标网页，点扩展的“连接”，再点“授权当前页”。核对列表中的标题和网址。</li><li><b>提问：</b>在 RSH 当前会话输入下方示例请求。只有授权页面会出现在 browser_tabs 中。</li><li><b>审批：</b>出现 browser_read 工具审批时，点击“允许一次”。不希望正文进入会话时点击“拒绝”。</li><li><b>查看：</b>展开 browser_read 工具结果，检查 title、url、text 和 truncated。truncated 为 true 表示正文被长度限制截断。</li><li><b>结束：</b>在扩展点“撤销”或“断开连接”。刷新、导航、关闭页面后原授权失效，需要重新授权。</li></ol>
<pre>读取已授权的浏览器页面，并引用来源网址。</pre><p>也可以在真实模型已配置后要求“总结页面的三个要点，并列出来源”。这种自然语言总结的实际质量尚未验收；工具返回正文成功与模型回答正确是两件事。</p>
<h2 id="test">五 预期效果与测试证据</h2>
<div class="notice"><b>分开看两次验证：</b>10月10日真实 Chrome 与 IDE 验收通过；10月12日修改后的定向测试通过，但真实 Chrome 复验因扩展弹窗调试超时未完成。旧截图不能证明修改后整条界面链路再次通过。</div>
<table class="section"><tr><th>预期</th><th>证据与观察</th><th>结论</th></tr>
<tr><td>合法合并或分段消息均可接收</td><td>10月12日两项消息边界用例通过</td><td>达标</td></tr>
<tr><td>轮询不丢点击和键盘焦点</td><td>10月12日扩展脚本与 DOM 回归用例通过；非真实 Chrome 弹窗</td><td>定向测试达标</td></tr>
<tr><td>授权失败保留原授权且并发不超限</td><td>10月12日扩展授权提交用例通过</td><td>定向测试达标</td></tr>
<tr><td>来源进入会话且冷读取一致</td><td>10月12日原有 Native 会话快照通过</td><td>达标</td></tr>
<tr><td>真实 Chrome 只读与撤销</td><td>10月10日通过，DOM 不变、写请求为 0；10月12日 CDP 弹窗调试超时</td><td>本次复验未完成</td></tr>
<tr><td>IDE 审批与成功结果可见</td><td>10月10日真实截图与 JSON 证据；10月12日未重跑</td><td>既有证据通过</td></tr>
<tr><td>从日常版本直接打开</td><td>功能分支未合并、未部署，需配置 Native Host</td><td>未交付</td></tr>
<tr><td>真实模型理解和引用质量</td><td>仅 offline fixture；没有真实本地或云端模型推理</td><td>未验证</td></tr></table>
<h3>10月12日实际检查结果</h3><ul><li>浏览器包定向测试：2 个文件、6 项通过，包含原有 2 项及新增 4 项。</li><li>原有 Native 会话快照：1 项通过，没有重写预期快照。</li><li>TypeScript 构建、tsdown 打包、最终三个生产文件的 Oxlint 检查通过。</li><li>中英文 README 与 Agent Note 两组配对检查、git diff --check 通过。</li><li>真实 Chrome：先修正脚本的页面就绪等待，再尝试不同弹窗调试方式，仍因超时未完成；不计为通过。</li></ul>
<h3>测试用例已按要求删除</h3><p>新增四个用例所在的 tests/details.spec.ts 在运行通过后删除，临时 Chrome 验收脚本也已删除。原有 browser.spec.ts、模型 fixture 与会话快照保留；没有新建或恢复这些测试。临时注册项、连接文件及本轮专用测试进程已清理。</p><p>这些新增边界用例不再保留为持续回归保护，其执行结果保存在10月12日优化记录中。本次制作图文材料没有重新运行产品测试，也没有调用收费模型。</p>
<h3>历史证据</h3><p>10月10日真实 Chrome/154.0.8037.99 读取中英文正文、排除表单与隐藏文本、撤销后拒绝、刷新失效和断连通过，DOM 不变且写请求为 0。IDE 既有证据包括审批、来源显示、冷启动历史及返回会话草稿恢复。历史文档检查为35项通过；这些不代替10月12日修复后的全链路复验。</p>
<h2>六 限制 费用与维护</h2><ul><li>10月10日仅 Windows Chrome 有通过证据，10月12日复验未完成；清单声明最低 Chrome 116，不代表已测试所有中间版本。</li><li>提取顶层文档的 main、article、main 角色元素或 body；不提供点击、输入、导航、提交、Cookie 读取、PDF、图片、OCR、iframe 或影子根提取。</li><li>同一文档动态变化可能影响下次读取。默认正文上限为 60000 个 UTF-16 字符，并非 token 或费用上限。</li><li>撤销只阻止后续读取，不删除已写入会话或已发送给模型的内容；网页文本按不可信来源处理。</li><li>本地连接组件无需服务订阅；本轮验收无外部模型推理。真实模型按所选提供商计费，本地与云端真实模型都未验收。</li><li>代码更新后需构建并在 Chrome 扩展页重新加载；源码或 Node 路径改变后需核对并重新注册本地连接。Host 重启或断连后手动重连并授权。</li></ul>
<table><tr><th>遇到的问题</th><th>处理方法</th></tr><tr><td>扩展连接失败</td><td>确认 Host 已运行，注册项和 profile 指向相同 connectionFile，Node 与转发程序路径有效。</td></tr><tr><td>不能授权</td><td>在普通 HTTP(S) 网页上打开扩展。内部页面、扩展页和本地文件不在支持范围。</td></tr><tr><td>没有浏览器工具</td><td>确认模块装在当前会话的 Host profile 中，且已重启相同 Host。</td></tr><tr><td>页面变化或超时</td><td>重新打开目标页并手动授权；不会自动重试。</td></tr><tr><td>连接文件已存在</td><td>先确认所属 Host 已停止，再处理残留文件；不要删除运行中 Host 的文件。</td></tr></table>
<h2>七 证据与后续状态</h2><p>本报告仅对应功能02，不代表文件引用、图片理解转接、工具分阶段开放等其他功能已完成。当前剩余交付事项是完成修复后的真实 Chrome 与 IDE 复验、提交与合并安排、日常版本接入，以及真实模型效果验证。本次没有执行这些变更。</p>
<p>本地证据位置：</p><pre>E:/redsparkHarness/RSH-feature/功能02-细节优化与回归-2026-10-12.md
E:/redsparkHarness/RSH-feature/功能02-浏览器只读接入验收收尾-2026-10-10.md
E:/redsparkHarness/RedSparkHarness-zero-budget-next/rsh/Docs/user/guide/browser-read-only.zh.md
E:/redsparkHarness/RedSparkHarness-zero-budget-next/.cache/zero-budget-validation/
  chrome-acceptance.json
  ide-browser-acceptance.json
  ide-cold-acceptance.json
  ide-return-acceptance.json</pre>
<p class="muted">报告与图片均可离线查看。所有截图已嵌入此文件，不依赖外部网站或相邻图片文件。报告更新日期：2026-10-12。</p>
</main></html>`;
fs.writeFileSync(path.join(out,'功能02总览图.html'),poster);
fs.writeFileSync(path.join(out,'功能02报告说明.html'),report);
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1.5});
  await page.goto(pathToFileURL(path.join(out,'功能02总览图.html')).href);
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:path.join(out,'功能02总览图.png'),fullPage:true});
  const overview=await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,images:[...document.images].every(i=>i.complete&&i.naturalWidth>0)}));
  await page.setViewportSize({width:1300,height:1000});
  await page.goto(pathToFileURL(path.join(out,'功能02报告说明.html')).href);
  const checks=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,images:[...document.images].every(i=>i.complete&&i.naturalWidth>0),sections:[...document.querySelectorAll('h2')].map(x=>x.textContent),text:document.body.innerText.length}));
  await page.screenshot({path:path.join(out,'报告排版检查.png'),fullPage:true});
  console.log(JSON.stringify({overview,report:checks},null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
