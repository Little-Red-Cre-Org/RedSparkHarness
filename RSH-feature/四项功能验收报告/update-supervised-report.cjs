const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, 'build.cjs');
let text = fs.readFileSync(file, 'utf8');
for (const [before, after] of [
  ['工具开放的 CLI 行为通过，桌面视觉与性能收益未验证', '图片 CLI 回放已补齐；工具组的真实 Native Web 操作与会话恢复通过，桌面整合与真实模型收益未验证'],
  ['CLI 行为通过</span><br>完整 Host 类型与桌面视觉验收未关闭', 'CLI / Web 流程通过</span><br>真实截图已补；完整 Host 汇总检查受内存限制'],
  ['完整 doc-sync 和独立仓库级 CLI 录制回放收尾仍未完成，不能当作最终全绿。', '本轮补齐一个真实 CLI 录制／回放场景，独立回放通过；86 个文档代码块检查通过。完整 doc-sync 仍未全部完成，不能当作最终全绿。'],
  ['<tr><td>桌面可见效果</td><td>没有新增页面；尚未做桌面视觉验收</td><td>未验证</td></tr>', '<tr><td>页面展示与持久会话</td><td>真实 Native Web 显示申请工具组、调用 todo_write 和完成清单；刷新后重新选择会话仍可查看</td><td>Web 达标；桌面整合未验证</td></tr>'],
  ['<pre>${esc(groupExample)}</pre><p class="muted">以上来自真实 CLI', '${figure(\'groups\', \'实际操作后的 Native Web 页面，使用离线固定响应模型\')}<pre>${esc(groupExample)}</pre><p class="muted">事件数据来自真实 CLI'],
  ['此处展示执行证据，不冒充产品页面。最终功能与目录测试', '页面与 CLI 记录分别提供可见效果和执行证据。前端复用源码逐文件一致的既有构建，Host 使用本分支源码。最终功能与目录测试'],
  ['完整 Host 聚合类型检查因内存不足未通过验收，定向类型、构建和文档补检通过。', '297 个依赖项目逐包编译通过；完整 Host 汇总类型检查仍因内存分配失败未通过，保留失败日志。'],
  ['图片功能的完整 doc-sync、仓库级 CLI 回放收尾，以及工具组完整 Host 类型检查仍有缺口', '图片功能的完整 doc-sync，以及工具组完整 Host 汇总类型检查仍有缺口；图片仓库级 CLI 回放已经通过。全库快照清单另被基线 GitHub webhook 场景的登记与 profile 元数据问题阻塞'],
  ['工具组未做桌面视觉验收；四项目前分属独立 worktree', '工具组已补真实 Native Web 页面验收，尚未做 Electron 桌面整合；四项目前分属独立 worktree'],
]) {
  if (!text.includes(before)) throw new Error('Missing report text: ' + before);
  text = text.replace(before, after);
}
fs.writeFileSync(file, text);
