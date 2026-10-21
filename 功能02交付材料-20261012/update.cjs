const fs = require('node:fs');
const path = require('node:path');
let source = fs.readFileSync(path.join(__dirname,'../功能02交付材料/build.cjs'),'utf8');
const replace = (from,to) => {
  if(!source.includes(from)) throw Error('Missing source text: '+from.slice(0,60));
  source=source.replace(from,to);
};
replace('代码与本地链路验收通过','已完成三项细节修复');
replace('IDE 图为真实验收截图，使用离线测试模型；真实云端模型效果尚未验证。','以下界面来自 10 月 10 日真实验收；10 月 12 日 Chrome 复验调试超时，未完成。');
replace('<section class="section"><h2><span class="num">02</span> 真实界面长这样</h2>',
`<section class="section"><h2>10 月 12 日优化了什么</h2><div class="grid" style="grid-template-columns:repeat(3,1fr)"><div class="card"><h3>消息不再误判超限</h3><p>按单条消息计算大小，正确处理消息合并与分段到达。</p></div><div class="card"><h3>点击与键盘焦点稳定</h3><p>轮询期间的操作按顺序执行；未变化的列表不重建按钮。</p></div><div class="card"><h3>重新授权更准确</h3><p>验证成功才替换原授权；提交时复核并发授权数量。</p></div></div></section><section class="section"><h2><span class="num">02</span> 真实界面长这样</h2>`);
replace('证据：定向测试 2 项 + 会话快照 1 项 + 真实 Chrome 验收通过；IDE 为此前同日证据。','10 月 12 日：定向测试 6 项、会话快照 1 项、构建、定向 lint 与双语配对检查通过。<br>新增测试用例已按要求删除；Chrome 复验未完成；真实模型未验。');
replace('基线 878d740a · 2026-10-10 · 配套文件','基线 878d740a · 更新于 2026-10-12 · 配套文件');
replace('REDSPARK HARNESS · 2026-10-10','REDSPARK HARNESS · 更新于 2026-10-12');
replace('结论：代码与本地浏览器、离线会话链路验收通过；尚未提交、合并或部署日常版本。','结论：三项细节修复及定向检查完成；真实 Chrome 复验未完成，尚未提交、合并或部署日常版本。');
source=source.replaceAll('同日已完成的离线验收','10月10日完成的离线验收').replaceAll('同日既有真实验收通过，本轮未重跑','10月10日既有真实验收通过，10月12日未重跑');
replace('已实现，真实 Chrome 通过','已实现；10月10日通过，10月12日复验未完成');
replace('<h2 id="ui">二 真实界面与入口</h2>',
`<h3>10月12日新增修复</h3><table><tr><th>问题</th><th>实际改动</th></tr><tr><td>多个合法消息合并到达时被误判超限</td><td>1 MiB 限制按单条消息计算；按帧缓冲，支持分段帧头、正文及连续消息。</td></tr><tr><td>弹窗轮询可能忽略点击并丢失键盘焦点</td><td>用户操作排在进行中的请求之后；授权列表不变时保留现有按钮。</td></tr><tr><td>重新授权过早撤销原授权，并发数量检查过早</td><td>文档验证成功才替换授权；在提交时复核当前授权数量。</td></tr></table><p class="section">仅修改浏览器包的 src/wire.ts、extension/popup.js、extension/background.js 及相关文档，没有新增依赖、配置开关或框架。上述修复不改变下方界面布局与按钮入口。</p><h2 id="ui">二 真实界面与入口</h2>`);
const start=source.indexOf('<h2 id="test">五 预期效果与测试证据</h2>');
const end=source.indexOf('<h2>六 限制 费用与维护</h2>',start);
if(start<0||end<0)throw Error('Missing evidence section');
source=source.slice(0,start)+`<h2 id="test">五 预期效果与测试证据</h2>
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
`+source.slice(end);
replace('仅 Windows Chrome 已验收；清单声明最低 Chrome 116','10月10日仅 Windows Chrome 有通过证据，10月12日复验未完成；清单声明最低 Chrome 116');
replace('当前剩余交付事项是提交与合并安排、日常版本接入，以及真实模型效果验证。','当前剩余交付事项是完成修复后的真实 Chrome 与 IDE 复验、提交与合并安排、日常版本接入，以及真实模型效果验证。');
replace('本地证据位置：</p><pre>','本地证据位置：</p><pre>E:/redsparkHarness/RSH-feature/功能02-细节优化与回归-2026-10-12.md\n');
replace('报告生成日期：2026-10-10。','报告更新日期：2026-10-12。');
// Only render the local deliverables; this builder does not launch the product or its tests.
replace('}finally{await browser.close()}','}finally{await browser.close()}');
fs.writeFileSync(path.join(__dirname,'build.cjs'),source);
