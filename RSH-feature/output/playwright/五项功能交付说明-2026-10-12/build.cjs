const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const out = __dirname;
const root = 'E:/redsparkHarness';
const esc = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const href = p => pathToFileURL(p).href;
const img = p => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
const launch = root + '/RedSparkHarness-image-understanding/output/playwright/启动图片理解.cmd';
const features = [
  {
    id:'image', n:'01', name:'图片理解', status:'当前配置验收通过', tone:'good',
    purpose:'上传图片、识别内容，继续追问；刷新后保留原图和回答。',
    screenshot:root+'/RedSparkHarness-image-understanding/output/playwright/optimization-live.png',
    caption:'真实产品截图 · 2026-10-12 · GPT-6 Luna 直传与原图追问',
    done:'已完成图片上传、直接识图／独立视觉转接机制、原图追问、历史恢复，以及滚动和窄屏布局优化。',
    shortDone:'上传、识图、追问、刷新恢复；已完成滚动与横屏布局优化。',
    open:'双击「启动图片理解.cmd」；启动器自动打开经过认证的本地页面。',
    shortOpen:'打开图片分支 output/playwright/启动图片理解.cmd。',
    steps:['点击“新建会话”，确认模型为 GPT-6 Luna。','点击“添加图片”，输入具体问题，点击“发送”；Shift+Enter 换行。','继续追问无需重传图片；刷新后从左侧选择原会话。'],
    shortSteps:'新建会话 → 添加图片并提问 → 查看回答、继续追问。',
    expected:'模型读懂图片；不重传也能追问；刷新恢复原图和两轮回答。',
    actual:'10 月 12 日真实 GPT-6 Luna 读出了模型名称、发送按钮位置和“+ 添加图片”，两次刷新恢复成功。最终结果 JSON 的 pass=true、errors=[]。',
    evidence:'原任务：41 项既有测试、3 项临时滚动回归通过；4 种窗口尺寸无溢出。监督复测：图片核心 4 项通过，同文件 17 项未选中。',
    limit:'当前配置使用 openai-codex / gpt-6-luna，实测属于图片直传。文本主模型经独立视觉模型转接本轮仅离线验证；未对其他主模型重做真实验收。发送会使用已有模型额度，金额未核算。',
    shortLimit:'今日实测为 GPT-6 Luna 直传；其他模型转接未重测。',
    worktree:'RedSparkHarness-image-understanding', branch:'codex/feature01-image-understanding',
    links:[['当前启动器',launch],['唯一入口说明',root+'/RedSparkHarness-image-understanding/output/playwright/当前唯一入口.md'],['本轮验收报告',root+'/RedSparkHarness-image-understanding/output/playwright/测试优化验收报告.md'],['最终机器结果',root+'/RedSparkHarness-image-understanding/output/playwright/optimization-final-result.json']],
    openingDetails:'启动器使用独立的 feature01-connected-home，固定端口 55301；本报告制作时端口有监听。请优先运行启动器完成认证，不要复制历史带令牌地址。旧端口 59317 已停用，旧 delivery 启动入口不再作为当前入口。旧会话若仍选中 EvoMap，请改为 GPT-6 Luna。',
    commands:[]
  },
  {
    id:'reference', n:'02', name:'文件／会话引用', status:'核心流程验收通过', tone:'good',
    purpose:'把相关文件、文件夹或另一段对话带入当前任务。',
    screenshot:'C:/Users/12148/.codex/visualizations/2026/10/10/01a12514-75c7-74d1-afd6-80766eefc3fc/reference-selected.png',
    caption:'真实产品历史截图 · 2026-10-10 · 草稿中的文件引用标签',
    done:'已完成／验证 @ 搜索、中文与空格路径、目录下钻、引用标签、预览和对话引用，并提供离线中文指南。',
    shortDone:'@ 搜索、目录下钻、引用标签、预览与中文使用指南。',
    open:'在已运行的 RSH Web 或 IDE 内嵌对话中选好工作区，点击聊天输入框，输入 @。',
    shortOpen:'已运行的 RSH 对话 → 选工作区 → 输入 @。',
    steps:['输入 @ 和部分文件名，在“文件与文件夹”或“对话”分组选择内容。','点击文件标签预览核对；选中文件夹后按 Tab 可进入目录。','补充需求再发送，例如“请读取这个文件并解释用途”。'],
    shortSteps:'@ 搜索选择 → 点击标签预览 → 补充需求并发送。',
    expected:'正确选择与序列化引用；目录可下钻；发送前可预览；会话上下文有界隔离。',
    actual:'10 月 12 日原任务的真实浏览器 reference-composer 与 sidebar-right 共 21 项通过，包含引用选择、目录导航、预览、重载和中文文案。',
    evidence:'清理临时用例后原有回归 91 通过、1 跳过。扩展文件接口 147 通过、6 失败，均因 Windows 创建符号链接 EPERM，未执行到产品断言。监督复测路径搜索 12 通过、1 跳过。',
    limit:'文件引用是路径，标签出现不代表模型已读正文；文件夹不会自动打包全部内容。对话引用提供有限只读快照。选择与预览不调用模型，发送可能消耗额度。临时测试服务已退役，本分支修复未部署到日常桌面版本。',
    shortLimit:'旧测试启动页已移除；独立分支修复尚未部署。',
    worktree:'RedSparkHarness-reference-acceptance', branch:'codex/reference-acceptance',
    links:[['中文使用指南',root+'/RedSparkHarness-reference-acceptance/rsh/Docs/user/guide/file-references.zh.md'],['本轮复验报告',root+'/RedSparkHarness-reference-acceptance/output/文件引用-复验与清理报告-2026-10-12.md'],['真实页面验收日志',root+'/RedSparkHarness-reference-acceptance/.artifacts/reference-review-20261012/web-e2e.log']],
    openingDetails:'这是聊天输入框的现有功能，没有独立“文件引用应用”。本轮新增修复位于 reference-acceptance 分支；旧 reference-live 演示脚本及 55544 临时服务已清理，不能再用历史演示地址启动。若只需学习操作，可直接打开中文指南。',
    commands:[]
  },
  {
    id:'groups', n:'03', name:'按需工具组', status:'核心通过 · 桌面待验收', tone:'warn',
    purpose:'模型先获得基础工具，需要更多能力时再申请对应工具组。',
    screenshot:root+'/RedSparkHarness-tool-groups/output/playwright/feature03-tool-groups.png',
    caption:'真实 Native Web 历史截图 · 2026-10-10 · 离线固定回复模型',
    done:'已实现配置初始工具／工具组、申请后下一轮开放、普通与程序调用统一限制，以及同任务恢复和新任务隔离。',
    shortDone:'按需申请、下一轮开放、恢复与隔离；保留原有审批规则。',
    open:'需要在工具组分支的 Native profile 中启用插件。没有独立图形开关；启用后仍在普通对话里使用。',
    shortOpen:'Native profile 启用 tool-groups 后，在普通对话中使用。',
    steps:['配置者启用插件，设置 initial 与 groups，并确保 tools、activeSessions 可用。','用户正常描述任务，例如“阅读 README 并补充启动说明”。','模型调用 request_tool_group；下一轮得到工具，实际操作仍遵守审批。'],
    shortSteps:'配置工具组 → 描述任务 → 模型申请，下一轮使用。',
    expected:'工具集合按需要增加；未开放不能提前调用；恢复和并发任务不互相扩权。',
    actual:'实际 Native Web 的离线验收完成“申请 planning → 下一轮 todo_write → 完成清单”，重载后可恢复记录。10 月 12 日补验初始集合、恢复、并发隔离和 CLI 回放。',
    evidence:'今日报告分次合计 26 项不同用例最终通过，定向编译和 lint 通过。监督独立复测既有核心 2 项通过。完整 Host 汇总检查此前因内存不足退出，尚未关闭。',
    limit:'真实桌面验收和真实模型决策效果尚未完成；没有图形化设置面板。申请可能增加模型往返，未测量 token、缓存或费用净收益。旧 Web 验收服务已经关闭。',
    shortLimit:'完整 Host 与真实桌面验收未完成；费用收益未测量。',
    worktree:'RedSparkHarness-tool-groups', branch:'codex/feature03-tool-groups',
    links:[['插件配置说明',root+'/RedSparkHarness-tool-groups/rsh/Modules/Official/guard/tool-groups/README.zh.md'],['用户使用与配置报告',root+'/RSH-feature/功能03-用户说明与验收报告.md'],['今日优化复核',root+'/RSH-feature/功能03-2026-10-12优化复核.md']],
    openingDetails:'先安装实际需要的工具及 native-session-execution 服务，再在同一作用域安装工具组插件；应用配置必须 builtinTools: false。下面仅是安装条目，不是完整 profile，不能覆盖原配置。示例工具 read、write、edit 必须已经安装。',
    commands:[['安装条目（配置示例）',JSON.stringify({id:'tool-groups',plugin:'@deepseek-ai/dsh-tool-groups',scope:'root',config:{initial:['read'],groups:[{name:'editing',description:'创建或修改工作区文件',tools:['write','edit']}]}},null,2)]]
  },
  {
    id:'browser', n:'04', name:'浏览器只读', status:'真实 Chrome 复验未通过', tone:'bad',
    purpose:'读取你逐页授权的网页正文，用于总结、分析并保留来源。',
    screenshot:root+'/RedSparkHarness-zero-budget-next/.cache/zero-budget-validation/chrome-authorized.png',
    caption:'历史真实 Chrome 弹窗 · 2026-10-10 · 不能代表当前复验通过',
    done:'已实现连接、逐页授权、正文读取、来源记录、撤销及重新连接失效；本轮修复分帧、轮询焦点和并发授权边界。',
    shortDone:'连接、逐页授权、读取、来源记录与撤销；本轮已修复边界问题。',
    open:'配置 Native Host 并注册 Chrome 连接组件，加载 RedSpark Harness Read Only 扩展；从工具栏或 Alt+Shift+R 打开。',
    shortOpen:'配置 Host 与 Chrome 扩展后，点击扩展或按 Alt+Shift+R。',
    steps:['在普通 HTTP(S) 页面打开扩展，点击“连接”。','点击“授权当前页”，核对标题和网址。','在 RSH 请求读取并通过会话审批；用完在扩展中撤销或断开。'],
    shortSteps:'连接 → 授权当前页 → 对话请求读取，结束后撤销。',
    expected:'只有授权页面可读；读取不操作页面；撤销、刷新与断开后阻止后续读取。',
    actual:'模块、离线会话快照及构建通过；10 月 12 日真实 Chrome 复验仍在扩展弹窗 CDP 调试阶段超时，没有完成本轮连接、授权、读取整条链路。',
    evidence:'原任务 2 文件／6 项测试通过（含 4 项临时用例），原有会话快照通过；最终 lint、构建、双语配对通过。监督复测原有模块 2 项通过。10 月 10 日成功实拍仅保留作历史证据。',
    limit:'当前不能标记为整体完成或稳定可用。只读顶层正文，不点击、不输入、不读 Cookie、PDF、图片或 iframe。授权不等于免除会话审批。旧 08:57 验收残留目录仍存在；新一轮注册项及连接文件已清理。',
    shortLimit:'当前弹窗调试超时；图中成功连接仅是历史记录。',
    worktree:'RedSparkHarness-zero-budget-next', branch:'codex/zero-budget-next',
    links:[['安装与操作指南',root+'/RedSparkHarness-zero-budget-next/rsh/Docs/user/guide/browser-read-only.zh.md'],['今日修复与复验报告',root+'/RSH-feature/功能02-细节优化与回归-2026-10-12.md'],['Chrome 扩展目录',root+'/RedSparkHarness-zero-budget-next/rsh/Modules/Official/web/browser-read-only/extension']],
    openingDetails:'接入前需有已构建的 Native Host profile（不是独立 native-ide 编辑器 profile）。依照安装指南添加浏览器插件，connectionFile 使用私有本地路径；注册脚本须指向同一个文件。随后到 chrome://extensions 打开开发者模式，加载已解压扩展，选择下面的 extension 目录。此处只提供步骤，本报告没有安装扩展或修改日常配置。',
    commands:[['扩展目录',root+'/RedSparkHarness-zero-budget-next/rsh/Modules/Official/web/browser-read-only/extension'],['在该功能工作树根目录执行（先完成 Host 配置）',"$connectionFile = Join-Path $env:LOCALAPPDATA 'RedSparkHarness/browser-read-only/connection.json'\n& ./rsh/Modules/Official/web/browser-read-only/scripts/register-chrome.ps1 -ConnectionFile $connectionFile"]]
  },
  {
    id:'ide', n:'05', name:'内置 IDE', status:'核心交互已有验收', tone:'good',
    purpose:'在 RSH 内编辑、保存、运行代码，并与任务对话联动。',
    screenshot:root+'/RedSparkHarness-ide-integration/.artifacts/ide-acceptance-20261010/editor-save.png',
    caption:'隔离工作区真实截图 · 2026-10-10 · 编辑保存；非最新版全界面',
    done:'已实现 Code OSS 编辑器、项目与文件操作、Python／Java／C／C++ 运行、AI 选区引用、代码插入和差异预览应用。',
    shortDone:'编辑保存、项目操作、多语言运行、代码发给 AI、差异预览应用。',
    open:'在支持此功能的 RSH 桌面版中，打开工作区行菜单，选择“用 IDE 方式打开”。',
    shortOpen:'RSH 桌面 → 工作区行菜单 →「用 IDE 方式打开」。',
    steps:['打开项目或文件夹，选择文件编辑；新文件先指定保存位置。','点击“运行当前文件”；需要时在下方终端输入，点击停止结束程序。','选中代码按 Ctrl+Alt+L 加入任务草稿；AI 返回后可插入或查看差异。'],
    shortSteps:'打开工作区 → 编辑保存／运行 → 选区发给 AI、预览并应用。',
    expected:'编辑与对话共享工作区；运行可交互；应用修改支持撤销，旧预览不覆盖后续编辑。',
    actual:'10 月 11 日真实桌面验收覆盖编辑保存、四种语言交互运行、停止、定义跳转、重命名、代码插入与差异预览。10 月 12 日复测 JSON 为 103 通过、0 失败、0 跳过。',
    evidence:'今日自动化结果已读取；本次报告制作没有重跑桌面操作。为避免带入个人会话截图，配图采用 10 月 10 日独立测试工作区的编辑保存实拍。最新功能范围以今日测试结果与 10 月 11 日报告为准。',
    limit:'不能推断任意 VS Code 插件兼容或真实模型能长期自主编码。图中是隔离 Native 编辑器验收，不展示最新集成 AI 侧栏。桌面两枚日常快捷方式都指向 main；不能保证打开独立分支的最新改动。',
    shortLimit:'日常快捷方式指向 main；不保证包含独立分支最新改动。',
    worktree:'RedSparkHarness-ide-integration', branch:'codex/native-ide-integration',
    links:[['桌面与 IDE 使用说明',root+'/RedSparkHarness-ide-integration/rsh/Programs/Desktop/README.zh.md'],['最新桌面交互验收报告',root+'/RedSparkHarness-ide-integration/.artifacts/ide-full-acceptance-20261011/IDE-全功能验收.md'],['今日 103 项复测结果',root+'/RedSparkHarness-ide-integration/.artifacts/ide-full-acceptance-20261011/retest-20261012.json']],
    openingDetails:'日常入口为 D:/RedSpark Harness.lnk 或 D:/RedSpark Harness IDE.lnk；本次核实两者都调用 main 工作树的 start-redspark.ps1，并非独立 IDE 分支启动器。若需复现本分支最新代码，应在下面的功能工作树使用仓库开发入口。此操作会构建开发产物，依赖本机已有运行时与配置，当前没有经核实可一键启动最新分支的交付脚本；本报告不伪造此入口。',
    commands:[['开发者复现分支（本次仅核对文档，未执行）',"Set-Location 'E:/redsparkHarness/RedSparkHarness-ide-integration'\npnpm run dev:desktop"]]
  }
];
for (const f of features) {
  f.image = img(f.screenshot);
  for (const [,p] of f.links) if (!fs.existsSync(p)) throw Error('Missing link '+p);
}
const css = `
*{box-sizing:border-box}body{margin:0;color:#262d39;font-family:'Microsoft YaHei','Segoe UI',sans-serif;background:#f6f3ee}a{color:#a6402c;text-underline-offset:4px}h1,h2,h3,p{margin:0}code,pre{font-family:Consolas,'Microsoft YaHei',monospace}img{display:block;max-width:100%}.muted{color:#68707a}.tag{display:inline-block;border-radius:30px;padding:7px 15px;font-size:16px;font-weight:700}.good{color:#28634d;background:#e4f2e8}.warn{color:#8a591c;background:#fff0d5}.bad{color:#a53e34;background:#fae5df}.eyebrow{font-size:16px;letter-spacing:2px;font-weight:700;color:#ac4c35}.notice{background:#fff0dc;border-left:5px solid #c1802a;padding:20px 24px;border-radius:4px 12px 12px 4px;line-height:1.8}.stamp{color:#6d747e;font-size:16px}.frame{background:#f1eeea;border:1px solid #dfd8d1;border-radius:12px;padding:14px;overflow:hidden}.frame img{width:100%;height:100%;object-fit:contain}.caption{color:#68707a;font-size:14px;line-height:1.6;margin-top:9px}.poster{width:1800px;padding:66px;background:#f6f3ee}.poster h1{font-size:58px;letter-spacing:-2px;margin:12px 0 16px}.poster .intro{font-size:26px;line-height:1.6;max-width:1450px}.poster .pills{display:flex;gap:12px;margin:22px 0 28px}.poster .tag{font-size:21px;padding:9px 20px}.poster-row{background:white;border:1px solid #e4ddd5;border-radius:22px;display:grid;grid-template-columns:710px 1fr;gap:32px;padding:28px;margin-top:22px;min-height:440px}.poster-row .frame{height:350px}.poster-row .caption{font-size:18px}.poster-row h2{font-size:35px;line-height:1.35;margin:0 0 13px}.num{color:#b85039;font-weight:400;margin-right:12px}.poster-row .row-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.poster-row .row-head .tag{font-size:17px;white-space:nowrap;padding:6px 12px}.poster-row .purpose{font-size:24px;line-height:1.5;color:#59616c;margin:0 0 17px}.facts{display:grid;grid-template-columns:86px 1fr;gap:10px 16px;font-size:23px;line-height:1.5}.facts b{color:#9b4a36}.poster-row .pending{font-size:20px;line-height:1.5;margin-top:18px;padding-top:13px;border-top:1px solid #e8e2da;color:#8b592d}.poster-footer{margin-top:27px;padding:24px 30px;background:#283438;color:#fff;border-radius:17px;font-size:22px;line-height:1.7}.poster-footer b{color:#f9d1b4}.poster-footer .small{font-size:18px;color:#cfd7d7;margin-top:8px}.report{max-width:1300px;margin:0 auto;padding:56px;background:#fff}.report h1{font-size:44px;line-height:1.35;margin:14px 0 20px}.report p{font-size:18px;line-height:1.85}.report .notice{margin:24px 0}.nav{display:flex;gap:18px;flex-wrap:wrap;margin:28px 0;font-size:18px}.tablewrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:16px;line-height:1.7;margin:20px 0}th,td{border-bottom:1px solid #e4e0da;text-align:left;vertical-align:top;padding:13px 12px}th{background:#f5f2ed}.feature{border-top:2px solid #e9e2da;padding-top:36px;margin-top:46px;scroll-margin-top:18px}.feature h2{font-size:34px;line-height:1.4;margin:0 0 12px}.feature h3{font-size:22px;margin:24px 0 12px}.feature>figure{margin:22px 0}.feature>figure img{max-height:740px;width:100%;object-fit:contain;background:#f6f3ee}.feature .summary{margin:15px 0}.two{display:grid;grid-template-columns:1fr 1fr;gap:20px}.box{background:#f7f5f1;border:1px solid #e4ddd5;border-radius:12px;padding:22px}.box h3{margin:0 0 12px}.box p{font-size:17px}ol,ul{padding-left:26px;font-size:18px;line-height:1.85;margin:12px 0}li{margin:8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#263237;color:#f4eee5;border-radius:10px;padding:20px;font-size:15px;line-height:1.8}code{overflow-wrap:anywhere}.path{font-size:15px;background:#f3f1ed;border:1px solid #e1dbd4;padding:12px 16px;border-radius:8px;overflow-wrap:anywhere;margin:12px 0}.links{display:flex;flex-wrap:wrap;gap:12px;margin-top:20px}.links a{border:1px solid #decfc3;border-radius:8px;padding:10px 14px;text-decoration:none;font-size:16px}.meta{margin-top:20px;color:#68707a;font-size:15px;line-height:1.8;overflow-wrap:anywhere}.end{border-top:2px solid #e9e2da;margin-top:48px;padding-top:30px}.end h2{font-size:28px;margin-bottom:20px}.report-footer{font-size:14px!important;color:#6c7278;margin-top:25px!important}@media(max-width:800px){.report{padding:24px 18px}.report h1{font-size:32px}.two{grid-template-columns:1fr}.feature h2{font-size:28px}.report p,ol,ul{font-size:16px}}@media print{body{background:#fff}.report{padding:0;max-width:none}.nav{display:none}.feature{break-before:page}.box,figure{break-inside:avoid}a{color:inherit}.links a{border:none;padding:0}}
`;
const head = title => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${css}</style></head><body>`;
const pRow = f => `<article class="poster-row" id="${f.id}"><div><div class="frame"><img src="${f.image}" alt="${esc(f.name)}真实截图"></div><p class="caption">${esc(f.caption)}</p></div><div><div class="row-head"><h2><span class="num">${f.n}</span>${f.name}</h2><span class="tag ${f.tone}">${f.status}</span></div><p class="purpose">${f.purpose}</p><div class="facts"><b>已完成</b><span>${f.shortDone}</span><b>怎么开</b><span>${f.shortOpen}</span><b>怎么用</b><span>${f.shortSteps}</span></div><p class="pending">${f.shortLimit}</p></div></article>`;
const poster = head('RSH 五项功能总览')+`<main class="poster"><div class="eyebrow">REDSPARK HARNESS · 2026.10.12 · 交付与使用</div><h1>5 项功能：做了什么，怎么用</h1><p class="intro">真实界面、打开入口、使用步骤放在同一张图。各项处于独立开发分支，验收通过范围与实际部署分开说明。</p><div class="pills"><span class="tag good">图片／引用／IDE：已有核心验收</span><span class="tag warn">工具组：桌面待验收</span><span class="tag bad">浏览器：Chrome 复验未通过</span></div>${features.map(pRow).join('')}<div class="poster-footer"><b>图片功能启动器：</b>E:/redsparkHarness/RedSparkHarness-image-understanding/<br>output/playwright/启动图片理解.cmd<br><b>先读报告再启用：</b>文件引用没有独立应用；工具组和浏览器需要配置；日常快捷方式不等于最新功能分支。<div class="small">完整路径、配置和证据见同目录《RSH-五项功能报告.html》。截图原样嵌入，均标注来源日期；未伪造当前成功状态。发送任务可能使用模型额度，本报告制作未调用模型。</div></div></main></body></html>`;
fs.writeFileSync(path.join(out,'总览排版.html'),poster);
const section = f => `<section class="feature" id="${f.id}"><h2><span class="num">${f.n}</span>${f.name}</h2><span class="tag ${f.tone}">${f.status}</span><p class="summary">${f.purpose}</p><figure><a href="${href(f.screenshot)}"><img src="${f.image}" alt="${esc(f.name)}真实界面"></a><figcaption class="caption">${f.caption}。点击图片查看原文件。</figcaption></figure><h3>完成了什么</h3><p>${f.done}</p><h3>怎么打开</h3><p>${f.open}</p><p>${f.openingDetails}</p>${f.id==='image'?`<div class="path">${esc(launch)}</div><p class="muted">在资源管理器地址栏粘贴以上完整路径并回车，或进入对应目录双击。浏览器可能只下载启动脚本，HTML 链接不保证直接执行。</p>`:''}${f.commands.map(([label,code])=>`<h3>${esc(label)}</h3><pre>${esc(code)}</pre>`).join('')}<h3>怎么使用</h3><ol>${f.steps.map(s=>`<li>${s}</li>`).join('')}</ol><div class="two"><div class="box"><h3>预期效果</h3><p>${f.expected}</p></div><div class="box"><h3>实际观察</h3><p>${f.actual}</p></div></div><h3>验收证据</h3><p>${f.evidence}</p><div class="notice"><strong>未完成与使用边界</strong><p>${f.limit}</p></div><div class="links">${f.links.map(([label,p])=>`<a href="${href(p)}">${label}</a>`).join('')}<a href="${f.n}-${f.name.replaceAll('／','-')}.png">本项说明图片</a></div><p class="meta">工作树：${root}/${f.worktree}<br>分支：${f.branch}<br>状态：本轮新增实现／修复仍在独立工作树；本报告未提交、合并或部署。</p></section>`;
const report = head('RSH 五项功能报告 · 2026-10-12')+`<main class="report"><div class="eyebrow">REDSPARK HARNESS · 使用与验收报告</div><h1>五项功能的完成情况、真实界面与使用方法</h1><p class="stamp">资料核查：2026 年 10 月 12 日 · Windows 本机 · 面向当前独立开发工作树</p><div class="notice"><strong>结论：五项均有实现，但不能宣布全部交付完成。</strong><p>图片、文件引用、IDE 已有对应范围的通过证据；工具组尚缺完整 Host 检查和真实桌面验收；浏览器真实 Chrome 复验仍超时。各项测试环境不同，不能把多个分支的截图当作已集成进同一个日常版本。</p></div><div class="links"><a href="RSH-五项功能总览.png">打开一张总览图</a><a href="RSH-五项功能报告.md">纯文字 Markdown 版</a><a href="${href(root+'/RSH-feature/五项功能监督复核-2026-10-12.md')}">监督复核记录</a></div><nav class="nav">${features.map(f=>`<a href="#${f.id}">${f.n} ${f.name}</a>`).join('')}</nav><div class="tablewrap"><table><thead><tr><th>功能</th><th>完成／验收情况</th><th>实际入口</th></tr></thead><tbody>${features.map(f=>`<tr><td><a href="#${f.id}">${f.name}</a></td><td>${f.status}</td><td>${f.shortOpen}</td></tr>`).join('')}</tbody></table></div><p>本报告中的编号仅为阅读顺序。图片功能目前可使用既有启动器；其余功能按对应环境与前置配置操作。没有独立页面或没有可用一键启动器的项目，均在下文明确说明。</p>${features.map(section).join('')}<section class="end"><h2>部署、费用与证据说明</h2><ul><li>本轮未合入 main、未覆盖日常版本、未安装浏览器扩展、未更改模型配置。两枚桌面 RSH 快捷方式均已核实指向 main。</li><li>浏览器图、文件引用图、工具组图为 10 月 10 日真实历史画面；IDE 选用同日隔离编辑保存截图，避免带入个人会话；图片理解图为 10 月 12 日真实模型验收。</li><li>工具组截图中的模型为离线固定回复，不证明真实模型决策。图片当前真实验收使用 GPT-6 Luna 直传，不混同独立视觉转接。</li><li>打开本报告、查看截图和离线指南不调用模型；在产品内发送消息可能消耗已有额度。工具组的费用净节省尚未测量。</li><li>监督阶段独立复测共 20 项通过、1 项既有跳过；图片同文件另 17 项未选中。各开发任务的用例数分开引用，不相加冒充统一整体验收。</li><li>报告制作只核实入口、资料和图片排版，没有重做产品全量测试，也没有宣称后台自动监督已建立。</li></ul><h3>仍需收尾</h3><ol><li>浏览器：定位扩展弹窗超时，完成修复后的连接、授权、读取、撤销实测，并核对旧临时目录。</li><li>工具组：关闭 Host 聚合检查与真实桌面验收；说明可供日常使用的实际启用配置。</li><li>文件引用：有符号链接权限的环境补验 6 项；图片与 IDE 保留模型／平台／稳定性范围限制。</li><li>之后再在明确授权下整合与部署，不能把本份功能说明当作上线通知。</li></ol><p class="report-footer">此 HTML 内嵌全部界面截图，可离线阅读；本机启动器与证据链接依赖原文件路径。来源均为已核查的本地源码说明、验收报告及机器结果。总览图与单项图是对这些真实截图的排版，不是产品界面设计稿。</p></section></main></body></html>`;
fs.writeFileSync(path.join(out,'RSH-五项功能报告.html'),report);
const markdown = `# RSH 五项功能报告\n\n日期：2026-10-12。五项均有实际实现；浏览器 Chrome 复验仍未通过，工具组 Host 与桌面验收未完成。未合入 main 或部署。\n\n[打开含截图 HTML 报告](./RSH-五项功能报告.html) · [查看一张总览图](./RSH-五项功能总览.png)\n\n`+features.map(f=>`## ${f.n} ${f.name}\n\n**${f.status}**\n\n${f.purpose}\n\n- 已完成：${f.done}\n- 怎么打开：${f.open}\n- 入口详情：${f.openingDetails}\n${f.id==='image'?`- 启动器：\`${launch}\`\n`:''}\n${f.commands.map(([label,code])=>`${label}：\n\n\`\`\`\n${code}\n\`\`\`\n`).join('\n')}\n操作步骤：\n\n${f.steps.map((s,i)=>`${i+1}. ${s}`).join('\n')}\n\n预期：${f.expected}\n\n实际：${f.actual}\n\n验证：${f.evidence}\n\n未完成与边界：${f.limit}\n\n图片：${f.caption}；[查看本项说明图](./${f.n}-${f.name.replaceAll('／','-')}.png)。\n\n工作树：\`${root}/${f.worktree}\`；分支：\`${f.branch}\`。\n\n${f.links.map(([label,p])=>`- [${label}](${p})`).join('\n')}\n`).join('\n')+`\n## 总体边界\n\n日常桌面两枚 RSH 快捷方式均指向 main，不代表独立分支最新改动已部署。报告制作未修改产品配置或调用模型；实际发送任务可能使用已有模型额度。浏览器与工具组未完成项保持开放，不能宣布五项全部交付完成。\n`;
fs.writeFileSync(path.join(out,'RSH-五项功能报告.md'),markdown);
fs.writeFileSync(path.join(out,'render-manifest.json'),JSON.stringify(features.map(f=>({id:f.id,file:f.n+'-'+f.name.replaceAll('／','-')+'.png',source:f.screenshot,caption:f.caption})),null,2));
console.log(JSON.stringify({output:out,features:features.length,embeddedImages:features.length,linksChecked:features.reduce((n,f)=>n+f.links.length,0)},null,2));
