# RSH 五项功能报告

日期：2026-10-12。五项均有实际实现；浏览器 Chrome 复验仍未通过，工具组 Host 与桌面验收未完成。未合入 main 或部署。

[打开含截图 HTML 报告](./RSH-五项功能报告.html) · [查看一张总览图](./RSH-五项功能总览.png)

## 01 图片理解

**当前配置验收通过**

上传图片、识别内容，继续追问；刷新后保留原图和回答。

- 已完成：已完成图片上传、直接识图／独立视觉转接机制、原图追问、历史恢复，以及滚动和窄屏布局优化。
- 怎么打开：双击「启动图片理解.cmd」；启动器自动打开经过认证的本地页面。
- 入口详情：启动器使用独立的 feature01-connected-home，固定端口 55301；本报告制作时端口有监听。请优先运行启动器完成认证，不要复制历史带令牌地址。旧端口 59317 已停用，旧 delivery 启动入口不再作为当前入口。旧会话若仍选中 EvoMap，请改为 GPT-6 Luna。
- 启动器：`E:/redsparkHarness/RedSparkHarness-image-understanding/output/playwright/启动图片理解.cmd`


操作步骤：

1. 点击“新建会话”，确认模型为 GPT-6 Luna。
2. 点击“添加图片”，输入具体问题，点击“发送”；Shift+Enter 换行。
3. 继续追问无需重传图片；刷新后从左侧选择原会话。

预期：模型读懂图片；不重传也能追问；刷新恢复原图和两轮回答。

实际：10 月 12 日真实 GPT-6 Luna 读出了模型名称、发送按钮位置和“+ 添加图片”，两次刷新恢复成功。最终结果 JSON 的 pass=true、errors=[]。

验证：原任务：41 项既有测试、3 项临时滚动回归通过；4 种窗口尺寸无溢出。监督复测：图片核心 4 项通过，同文件 17 项未选中。

未完成与边界：当前配置使用 openai-codex / gpt-6-luna，实测属于图片直传。文本主模型经独立视觉模型转接本轮仅离线验证；未对其他主模型重做真实验收。发送会使用已有模型额度，金额未核算。

图片：真实产品截图 · 2026-10-12 · GPT-6 Luna 直传与原图追问；[查看本项说明图](./01-图片理解.png)。

工作树：`E:/redsparkHarness/RedSparkHarness-image-understanding`；分支：`codex/feature01-image-understanding`。

- [当前启动器](E:/redsparkHarness/RedSparkHarness-image-understanding/output/playwright/启动图片理解.cmd)
- [唯一入口说明](E:/redsparkHarness/RedSparkHarness-image-understanding/output/playwright/当前唯一入口.md)
- [本轮验收报告](E:/redsparkHarness/RedSparkHarness-image-understanding/output/playwright/测试优化验收报告.md)
- [最终机器结果](E:/redsparkHarness/RedSparkHarness-image-understanding/output/playwright/optimization-final-result.json)

## 02 文件／会话引用

**核心流程验收通过**

把相关文件、文件夹或另一段对话带入当前任务。

- 已完成：已完成／验证 @ 搜索、中文与空格路径、目录下钻、引用标签、预览和对话引用，并提供离线中文指南。
- 怎么打开：在已运行的 RSH Web 或 IDE 内嵌对话中选好工作区，点击聊天输入框，输入 @。
- 入口详情：这是聊天输入框的现有功能，没有独立“文件引用应用”。本轮新增修复位于 reference-acceptance 分支；旧 reference-live 演示脚本及 55544 临时服务已清理，不能再用历史演示地址启动。若只需学习操作，可直接打开中文指南。


操作步骤：

1. 输入 @ 和部分文件名，在“文件与文件夹”或“对话”分组选择内容。
2. 点击文件标签预览核对；选中文件夹后按 Tab 可进入目录。
3. 补充需求再发送，例如“请读取这个文件并解释用途”。

预期：正确选择与序列化引用；目录可下钻；发送前可预览；会话上下文有界隔离。

实际：10 月 12 日原任务的真实浏览器 reference-composer 与 sidebar-right 共 21 项通过，包含引用选择、目录导航、预览、重载和中文文案。

验证：清理临时用例后原有回归 91 通过、1 跳过。扩展文件接口 147 通过、6 失败，均因 Windows 创建符号链接 EPERM，未执行到产品断言。监督复测路径搜索 12 通过、1 跳过。

未完成与边界：文件引用是路径，标签出现不代表模型已读正文；文件夹不会自动打包全部内容。对话引用提供有限只读快照。选择与预览不调用模型，发送可能消耗额度。临时测试服务已退役，本分支修复未部署到日常桌面版本。

图片：真实产品历史截图 · 2026-10-10 · 草稿中的文件引用标签；[查看本项说明图](./02-文件-会话引用.png)。

工作树：`E:/redsparkHarness/RedSparkHarness-reference-acceptance`；分支：`codex/reference-acceptance`。

- [中文使用指南](E:/redsparkHarness/RedSparkHarness-reference-acceptance/rsh/Docs/user/guide/file-references.zh.md)
- [本轮复验报告](E:/redsparkHarness/RedSparkHarness-reference-acceptance/output/文件引用-复验与清理报告-2026-10-12.md)
- [真实页面验收日志](E:/redsparkHarness/RedSparkHarness-reference-acceptance/.artifacts/reference-review-20261012/web-e2e.log)

## 03 按需工具组

**核心通过 · 桌面待验收**

模型先获得基础工具，需要更多能力时再申请对应工具组。

- 已完成：已实现配置初始工具／工具组、申请后下一轮开放、普通与程序调用统一限制，以及同任务恢复和新任务隔离。
- 怎么打开：需要在工具组分支的 Native profile 中启用插件。没有独立图形开关；启用后仍在普通对话里使用。
- 入口详情：先安装实际需要的工具及 native-session-execution 服务，再在同一作用域安装工具组插件；应用配置必须 builtinTools: false。下面仅是安装条目，不是完整 profile，不能覆盖原配置。示例工具 read、write、edit 必须已经安装。

安装条目（配置示例）：

```
{
  "id": "tool-groups",
  "plugin": "@deepseek-ai/dsh-tool-groups",
  "scope": "root",
  "config": {
    "initial": [
      "read"
    ],
    "groups": [
      {
        "name": "editing",
        "description": "创建或修改工作区文件",
        "tools": [
          "write",
          "edit"
        ]
      }
    ]
  }
}
```

操作步骤：

1. 配置者启用插件，设置 initial 与 groups，并确保 tools、activeSessions 可用。
2. 用户正常描述任务，例如“阅读 README 并补充启动说明”。
3. 模型调用 request_tool_group；下一轮得到工具，实际操作仍遵守审批。

预期：工具集合按需要增加；未开放不能提前调用；恢复和并发任务不互相扩权。

实际：实际 Native Web 的离线验收完成“申请 planning → 下一轮 todo_write → 完成清单”，重载后可恢复记录。10 月 12 日补验初始集合、恢复、并发隔离和 CLI 回放。

验证：今日报告分次合计 26 项不同用例最终通过，定向编译和 lint 通过。监督独立复测既有核心 2 项通过。完整 Host 汇总检查此前因内存不足退出，尚未关闭。

未完成与边界：真实桌面验收和真实模型决策效果尚未完成；没有图形化设置面板。申请可能增加模型往返，未测量 token、缓存或费用净收益。旧 Web 验收服务已经关闭。

图片：真实 Native Web 历史截图 · 2026-10-10 · 离线固定回复模型；[查看本项说明图](./03-按需工具组.png)。

工作树：`E:/redsparkHarness/RedSparkHarness-tool-groups`；分支：`codex/feature03-tool-groups`。

- [插件配置说明](E:/redsparkHarness/RedSparkHarness-tool-groups/rsh/Modules/Official/guard/tool-groups/README.zh.md)
- [用户使用与配置报告](E:/redsparkHarness/RSH-feature/功能03-用户说明与验收报告.md)
- [今日优化复核](E:/redsparkHarness/RSH-feature/功能03-2026-10-12优化复核.md)

## 04 浏览器只读

**真实 Chrome 复验未通过**

读取你逐页授权的网页正文，用于总结、分析并保留来源。

- 已完成：已实现连接、逐页授权、正文读取、来源记录、撤销及重新连接失效；本轮修复分帧、轮询焦点和并发授权边界。
- 怎么打开：配置 Native Host 并注册 Chrome 连接组件，加载 RedSpark Harness Read Only 扩展；从工具栏或 Alt+Shift+R 打开。
- 入口详情：接入前需有已构建的 Native Host profile（不是独立 native-ide 编辑器 profile）。依照安装指南添加浏览器插件，connectionFile 使用私有本地路径；注册脚本须指向同一个文件。随后到 chrome://extensions 打开开发者模式，加载已解压扩展，选择下面的 extension 目录。此处只提供步骤，本报告没有安装扩展或修改日常配置。

扩展目录：

```
E:/redsparkHarness/RedSparkHarness-zero-budget-next/rsh/Modules/Official/web/browser-read-only/extension
```

在该功能工作树根目录执行（先完成 Host 配置）：

```
$connectionFile = Join-Path $env:LOCALAPPDATA 'RedSparkHarness/browser-read-only/connection.json'
& ./rsh/Modules/Official/web/browser-read-only/scripts/register-chrome.ps1 -ConnectionFile $connectionFile
```

操作步骤：

1. 在普通 HTTP(S) 页面打开扩展，点击“连接”。
2. 点击“授权当前页”，核对标题和网址。
3. 在 RSH 请求读取并通过会话审批；用完在扩展中撤销或断开。

预期：只有授权页面可读；读取不操作页面；撤销、刷新与断开后阻止后续读取。

实际：模块、离线会话快照及构建通过；10 月 12 日真实 Chrome 复验仍在扩展弹窗 CDP 调试阶段超时，没有完成本轮连接、授权、读取整条链路。

验证：原任务 2 文件／6 项测试通过（含 4 项临时用例），原有会话快照通过；最终 lint、构建、双语配对通过。监督复测原有模块 2 项通过。10 月 10 日成功实拍仅保留作历史证据。

未完成与边界：当前不能标记为整体完成或稳定可用。只读顶层正文，不点击、不输入、不读 Cookie、PDF、图片或 iframe。授权不等于免除会话审批。旧 08:57 验收残留目录仍存在；新一轮注册项及连接文件已清理。

图片：历史真实 Chrome 弹窗 · 2026-10-10 · 不能代表当前复验通过；[查看本项说明图](./04-浏览器只读.png)。

工作树：`E:/redsparkHarness/RedSparkHarness-zero-budget-next`；分支：`codex/zero-budget-next`。

- [安装与操作指南](E:/redsparkHarness/RedSparkHarness-zero-budget-next/rsh/Docs/user/guide/browser-read-only.zh.md)
- [今日修复与复验报告](E:/redsparkHarness/RSH-feature/功能02-细节优化与回归-2026-10-12.md)
- [Chrome 扩展目录](E:/redsparkHarness/RedSparkHarness-zero-budget-next/rsh/Modules/Official/web/browser-read-only/extension)

## 05 内置 IDE

**核心交互已有验收**

在 RSH 内编辑、保存、运行代码，并与任务对话联动。

- 已完成：已实现 Code OSS 编辑器、项目与文件操作、Python／Java／C／C++ 运行、AI 选区引用、代码插入和差异预览应用。
- 怎么打开：在支持此功能的 RSH 桌面版中，打开工作区行菜单，选择“用 IDE 方式打开”。
- 入口详情：日常入口为 D:/RedSpark Harness.lnk 或 D:/RedSpark Harness IDE.lnk；本次核实两者都调用 main 工作树的 start-redspark.ps1，并非独立 IDE 分支启动器。若需复现本分支最新代码，应在下面的功能工作树使用仓库开发入口。此操作会构建开发产物，依赖本机已有运行时与配置，当前没有经核实可一键启动最新分支的交付脚本；本报告不伪造此入口。

开发者复现分支（本次仅核对文档，未执行）：

```
Set-Location 'E:/redsparkHarness/RedSparkHarness-ide-integration'
pnpm run dev:desktop
```

操作步骤：

1. 打开项目或文件夹，选择文件编辑；新文件先指定保存位置。
2. 点击“运行当前文件”；需要时在下方终端输入，点击停止结束程序。
3. 选中代码按 Ctrl+Alt+L 加入任务草稿；AI 返回后可插入或查看差异。

预期：编辑与对话共享工作区；运行可交互；应用修改支持撤销，旧预览不覆盖后续编辑。

实际：10 月 11 日真实桌面验收覆盖编辑保存、四种语言交互运行、停止、定义跳转、重命名、代码插入与差异预览。10 月 12 日复测 JSON 为 103 通过、0 失败、0 跳过。

验证：今日自动化结果已读取；本次报告制作没有重跑桌面操作。为避免带入个人会话截图，配图采用 10 月 10 日独立测试工作区的编辑保存实拍。最新功能范围以今日测试结果与 10 月 11 日报告为准。

未完成与边界：不能推断任意 VS Code 插件兼容或真实模型能长期自主编码。图中是隔离 Native 编辑器验收，不展示最新集成 AI 侧栏。桌面两枚日常快捷方式都指向 main；不能保证打开独立分支的最新改动。

图片：隔离工作区真实截图 · 2026-10-10 · 编辑保存；非最新版全界面；[查看本项说明图](./05-内置 IDE.png)。

工作树：`E:/redsparkHarness/RedSparkHarness-ide-integration`；分支：`codex/native-ide-integration`。

- [桌面与 IDE 使用说明](E:/redsparkHarness/RedSparkHarness-ide-integration/rsh/Programs/Desktop/README.zh.md)
- [最新桌面交互验收报告](E:/redsparkHarness/RedSparkHarness-ide-integration/.artifacts/ide-full-acceptance-20261011/IDE-全功能验收.md)
- [今日 103 项复测结果](E:/redsparkHarness/RedSparkHarness-ide-integration/.artifacts/ide-full-acceptance-20261011/retest-20261012.json)

## 总体边界

日常桌面两枚 RSH 快捷方式均指向 main，不代表独立分支最新改动已部署。报告制作未修改产品配置或调用模型；实际发送任务可能使用已有模型额度。浏览器与工具组未完成项保持开放，不能宣布五项全部交付完成。
