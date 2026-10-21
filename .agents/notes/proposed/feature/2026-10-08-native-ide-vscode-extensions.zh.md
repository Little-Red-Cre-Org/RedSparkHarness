# Agent Note: Native IDE with VS Code Extension Compatibility

Status: proposed

[English](2026-10-08-native-ide-vscode-extensions.md) | 中文

## Problem

RedSpark Harness 需要一套第一方 IDE，用于编辑真实工作区并接入成熟的 VS Code 扩展生态。仅使用 Monaco 可以提供文本编辑，但不包含 VS Code Workbench、扩展宿主或扩展 API。在 Native Runtime 中运行第三方扩展会混淆两种插件契约，并赋予它们不需要的同进程 RSH 插件权限。

## Proposal

将 IDE 构建为 Native profile application，并采用 Code - OSS Workbench。RSH Native 插件和 VS Code 扩展继续作为两套独立扩展系统。`Modules/Official` 下的 RSH 包提供 Harness 自有能力和范围受限的集成适配层；Code - OSS 负责 VS Code 扩展的发现、激活和 API 兼容。

### Runtime and ownership

Official Native IDE provider 持有 Code OSS 服务器及其扩展宿主子进程。受支持的 `dsh` profile 管理 provider；Desktop 持有外层 Electron 窗口与嵌入视图。现有 RSH Host 继续持有 Agent、Session 和工具执行。

适配扩展激活前，Desktop 将关闭决定交给 Code OSS 的卸载检查，不要求等待可能永远无法到达的扩展状态更新。已上报的未保存编辑仍阻止关闭。运行时和扩展存储位于未受信任项目目录之外，避免上游信任检查禁用适配扩展；不引入信任覆盖。

Code - OSS 扩展只运行在所选 Code - OSS 构建提供的扩展宿主中。它们不会作为 Native Runtime 插件加载，不会获得 NativeHost 服务访问权，也不会创建第二套 RSH Agent、Session 或 tool authority。RSH 发布的 VS Code 扩展可以通过由 Official Native IDE 包持有的、范围受限且有版本的接口，连接受支持的 IDE 命令和工作区状态。

IDE provider 持久保存首次绑定的回环端口，并为每个规范项目路径保留工作区文件。这样可保留上游浏览器及工作区存储，无需导出其数据库、重放信任授予或修改编辑器。令牌独立于这些标识轮换。端口冲突时激活失败；选择其他端口会进入其他浏览器 origin，使用户已有状态不可见。已有工作区设置仍由上游持有。

### Extension sources and compatibility

已验收的 REH Web 分发包含 Node TypeScript 服务，但不包含其浏览器包。Desktop 使用上游 `configurationDefaults` 和 `remote.extensionKind: { "vscode.typescript-language-features": ["workspace", "-web"] }` 选择 Node，并在工作区信任阻止 Node 激活时也排除浏览器回退。信任工作区后即可激活已有服务。此方式保留上游语言能力和用户覆盖，不修改或再分发上游扩展代码。验收通过实际工作台覆盖诊断、补全、定义跳转和跨文件重命名。

将 Code - OSS distribution 配置为使用 Open VSX。用户拥有相关使用权时，可从本地 VSIX 安装扩展。Code - OSS 衍生产品不得连接 Visual Studio Marketplace：Microsoft FAQ 明确说明这类产品不能访问 Marketplace（[Code - OSS 差异](https://github.com/microsoft/vscode/wiki/Differences-between-the-repository-and-Visual-Studio-Code)，[VS Code FAQ](https://code.visualstudio.com/Docs/supporting/faq)）。Open VSX 提供与 VS Code 扩展 gallery 设置兼容的 registry API（[Open VSX 配置](https://github.com/eclipse-openvsx/openvsx/wiki/Using-Open-VSX-in-VS-Code)）。

第一阶段以稳定版 VS Code Extension API 和桌面 Node.js 扩展宿主为目标。Web 扩展作为独立能力处理。兼容性通过公开的扩展矩阵衡量；产品不承诺 Open VSX 收录所有 Marketplace 扩展，也不承诺所有扩展都能在 Code - OSS 上运行。带有产品专属许可的 Microsoft 扩展和使用 proposed API 的扩展不属于首期兼容承诺（[扩展宿主](https://code.visualstudio.com/api/advanced-topics/extension-host)，[Web 扩展](https://code.visualstudio.com/api/extension-guides/web-extensions)，[Microsoft 扩展许可](https://code.visualstudio.com/docs/supporting/oss-extensions)）。

Code - OSS 源码采用 MIT 许可，但带有 VS Code 品牌的 distribution 包含独立的 Microsoft 定制和产品条款。应打包独立品牌和配置的 Code - OSS 构建，并保留其 notices 和第三方许可清单（[Code - OSS 产品元数据](https://github.com/microsoft/vscode/blob/main/product.json)）。

### First implementation slice

[native IDE profile](../../../../rsh/Programs/Web/host/native-ide/README.zh.md) 启动单独安装的 Code OSS REH Web distribution。Official provider 通过 Native subprocess service 持有进程树，并将设置和扩展保存在配置的数据目录中。[Desktop 适配层](../../../../rsh/Programs/Desktop/README.zh.md) 将工作台嵌入现有窗口，并安装内置本地 VSIX。Code OSS 持有文件、编辑器、终端和扩展；集成扩展添加项目任务与保留状态的 RSH 对话标签，两者使用现有 RSH Session authority。

适配层使用上游扩展 API 和启动配置，不修改上游源码，也不重新实现编辑器服务。 Desktop 通过已安装的 CLI 准备 profile，避免打包依赖自身文件位置的模板加载器。 provider 在服务器开始扫描扩展前完成 VSIX 安装，首次使用时的工作区切换必须保留适配器。每次启动独有的 Desktop 协议通过私有字节管道提供现有对话页面。绑定父页面的通道消息传递任务摘要和导航，不新增模型或工具执行 API。独立的逐 webview origin 从本地提供上游启动资源。当前集成要求标准 Desktop profile；native Desktop composition 会显示明确的不支持提示。

本地 Windows 验证使用 VSCodium REH Web 1.135.06055 及其 Node 扩展宿主。隔离 Desktop 冒烟覆盖对话和编辑器切换、选区传递、项目联动、未保存缓冲区、修改记录差异、PowerShell 执行及 Node 调试。Open VSX Prettier 12.4.0 完成安装、激活和真实文件格式化。无密钥文件工具回放通过实际 Web Host 与 Client 验证允许和拒绝修改。 Desktop README 维护已验收扩展矩阵。Windows 配置不提供 Bash 工具，因此审批几何测试使用应用自有的 PowerShell 回放；原 POSIX Session 录制保持不变。Native Desktop 集成、完整视觉一致性、独立任务检查面板、更广扩展兼容性和发布打包不在这一轮已验证范围内。

工作台通过内置主题、上游 editor/title 命令和按父页面通道同步的对话颜色实现视觉集成，不向上游 DOM 注入布局补丁。设计稿中的顶部居中分段切换仍未实现，采用现有编辑器工具栏避免维护上游内部结构。主题变更不写入模型上下文，也不修改 RSH 主题偏好；浅色、深色、外部消息拒绝和清理路径由布局测试验证。

### Task and editor integration

内置扩展通过带版本检查的插入操作，将编辑器选区追加到现有 Session 输入框，包括来源行列范围和未保存缓冲区内容，不自动发送草稿。Chat 文件链接由 Client 导航事件接管，按来源 Session 的目录解析后打开上游编辑器。项目切换使用 Code OSS 工作区文件夹 API；Client 等待目标草稿持久化通知后才发布新项目。草稿附件和正在进行的输入操作会暂缓编辑器切换，因为扩展宿主重启会销毁浏览器持有的附件对象。恢复后的扩展读取实际工作区文件夹，而非原始启动路径。不引入第二份 Session 存储或新的模型请求路径。 文件修改行通过 Code OSS 只读内容提供器打开已记录片段。每个片段单独比较，原文未知时明确标注。审批详情从关联的运行中调用提取文本建议；现有 Host 继续负责审批、执行、版本检查和 Session 结果。未增加编辑器侧应用修改 API，也未修改上游源码。

工作区菜单是按项目进入 Desktop IDE 的入口。preload 不暴露文件系统或模型执行 API：Client 从 Host 投影中解析被点击的 Workspace，Desktop 验证通信字段及规范目录后启动现有 IDE 管理器。原页面保持挂载。返回时等待原页面确认所选会话的文字交接，再隐藏 IDE；再次进入时先检查未保存编辑再重启，后台 Agent 执行仍由原 Host 管理。RSH 在进入时传递当前语言；Desktop 适配器按运行时自身的 NLS 键索引提供已安装的简体中文语言包，不修改上游源码，也不依赖翻译 CDN。

有路径的已修改文件按可配置延迟自动保存（100–10000 ms，默认 500），RSH 只公开延迟设置。扩展持有每个文件的计时器，计时结束前关闭标签页由 Code OSS 的焦点变化保存处理。返回及切换项目等待保存完成；Desktop 关闭请求与完成确认通过现有私有启动目录交接，保存失败时保留工作台及内容。

## Alternatives considered

- **使用 Monaco 作为 IDE 并由 RSH 实现兼容。** Monaco 不含 VS Code Workbench 或扩展宿主。重新实现这些系统会创建第二个编辑器平台，同时仍需大量实现 VS Code API。
- **将 VS Code 扩展作为 Native Runtime 插件加载。** 两者的扩展 API、激活模型和 runtime 均不同。直接将扩展代码映射到 NativeHost 会混淆生命周期和服务归属，并以同进程 RSH 插件权限运行第三方代码。
- **使用 Microsoft Visual Studio Marketplace。** Microsoft 发布的 FAQ 不允许 Code - OSS 衍生产品访问 Marketplace。Open VSX 和用户提供的 VSIX 文件可提供受支持的扩展来源，但不宣称目录覆盖相同。

## Acceptance criteria

- 受支持的 `dsh` profile 可以启动和停止 IDE，不新增第二个公开 application 入口。
- IDE 可编辑并保存用户选择的工作区，同时保留既有 RSH Desktop profile 和 Session 数据。
- 兼容矩阵记录代表性主题、声明式扩展和 Node.js 扩展的成功安装与激活，以及已知不支持项。
- IDE 支持从 Open VSX 和本地 VSIX 安装，且不查询 Visual Studio Marketplace。
- RSH 集成扩展只调用有文档的、带版本的 Native IDE 接口。VS Code 扩展不能直接访问 NativeHost 服务。
- 打包 distribution 标明它是基于 Code - OSS 的 RSH 产品，并保留要求的 notices 和第三方许可记录。
- Desktop 集成在每个受支持的发布平台上验证启动、工作区交接、进程清理和扩展宿主关闭。

## Risks

Code - OSS 会增加大量上游构建、安全更新和合并维护成本。Open VSX 不保证与 Marketplace 目录相同。VS Code 扩展是可执行代码，可通过宿主访问工作区文件、进程和网络；Native Runtime scope 不会为其提供沙箱。将 Code - OSS 嵌入现有 Electron Shell 可能重复 Electron 和 Node runtime，或需要长期维护 Workbench 集成。确定发布拓扑前，概念验证必须测量启动时间、内存、安装包体积、升级和 teardown。
