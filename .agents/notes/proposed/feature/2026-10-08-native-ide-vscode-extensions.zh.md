# Agent Note: Native IDE with VS Code Extension Compatibility

Status: proposed

[English](2026-10-08-native-ide-vscode-extensions.md) | 中文

## Problem

RedSpark Harness 需要一套第一方 IDE，用于编辑真实工作区并接入成熟的 VS Code 扩展生态。仅使用 Monaco 可以提供文本编辑，但不包含 VS Code Workbench、扩展宿主或扩展 API。在 Native Runtime 中运行第三方扩展会混淆两种插件契约，并赋予它们不需要的同进程 RSH 插件权限。

## Proposal

将 IDE 构建为 Native profile application，并采用 Code - OSS Workbench。RSH Native 插件和 VS Code 扩展继续作为两套独立扩展系统。`Modules/Official` 下的 RSH 包提供 Harness 自有能力和范围受限的集成适配层；Code - OSS 负责 VS Code 扩展的发现、激活和 API 兼容。

### Runtime and ownership

新增 Official Native IDE 包和选择它的受支持 `dsh` profile。该 profile 持有工作区服务、RSH 集成和 IDE 生命周期。Desktop 持有打包后的 Code - OSS runtime 及其进程生命周期。WorkBench 的呈现方式和进程传输仍由概念验证决定，因为现有 Desktop Shell 与 Code - OSS 都有自己的 Electron 和 renderer 生命周期。

Code - OSS 扩展只运行在所选 Code - OSS 构建提供的扩展宿主中。它们不会作为 Native Runtime 插件加载，不会获得 NativeHost 服务访问权，也不会创建第二套 RSH Agent、Session 或 tool authority。RSH 发布的 VS Code 扩展可以通过由 Official Native IDE 包持有的、范围受限且有版本的接口，连接受支持的 IDE 命令和工作区状态。

### Extension sources and compatibility

将 Code - OSS distribution 配置为使用 Open VSX。用户拥有相关使用权时，可从本地 VSIX 安装扩展。Code - OSS 衍生产品不得连接 Visual Studio Marketplace：Microsoft FAQ 明确说明这类产品不能访问 Marketplace（[Code - OSS 差异](https://github.com/microsoft/vscode/wiki/Differences-between-the-repository-and-Visual-Studio-Code)，[VS Code FAQ](https://code.visualstudio.com/Docs/supporting/faq)）。Open VSX 提供与 VS Code 扩展 gallery 设置兼容的 registry API（[Open VSX 配置](https://github.com/eclipse-openvsx/openvsx/wiki/Using-Open-VSX-in-VS-Code)）。

第一阶段以稳定版 VS Code Extension API 和桌面 Node.js 扩展宿主为目标。Web 扩展作为独立能力处理。兼容性通过公开的扩展矩阵衡量；产品不承诺 Open VSX 收录所有 Marketplace 扩展，也不承诺所有扩展都能在 Code - OSS 上运行。带有产品专属许可的 Microsoft 扩展和使用 proposed API 的扩展不属于首期兼容承诺（[扩展宿主](https://code.visualstudio.com/api/advanced-topics/extension-host)，[Web 扩展](https://code.visualstudio.com/api/extension-guides/web-extensions)，[Microsoft 扩展许可](https://code.visualstudio.com/docs/supporting/oss-extensions)）。

Code - OSS 源码采用 MIT 许可，但带有 VS Code 品牌的 distribution 包含独立的 Microsoft 定制和产品条款。应打包独立品牌和配置的 Code - OSS 构建，并保留其 notices 和第三方许可清单（[Code - OSS 产品元数据](https://github.com/microsoft/vscode/blob/main/product.json)）。

### First implementation slice

首个切片通过 [native IDE profile](../../../../rsh/Programs/Web/host/native-ide/README.zh.md)，在浏览器中打开单独安装的 Code OSS REH Web 发行版。Official provider 通过 Native subprocess 服务持有进程树，将设置和扩展存放在配置的数据目录。该切片直接保留上游扩展 API，不在 RSH 中重新实现这些 API。它不包含 Desktop 内嵌、agent 命令桥接或运行时再分发。

本地 Windows 验证采用 VSCodium REH Web 1.135.06055（VS Code API 1.135.0、Node 24.18.1）。本地 VSIX fixture `rsh-local-verification.native-ide-smoke@0.0.1` 能够安装、在 Node 扩展宿主中激活并执行其注册命令。浏览器自动化通过工作台编辑并保存了真实工作区文件。这些结果覆盖一个 fixture，不代表第三方扩展兼容性或发布平台矩阵。Open VSX 安装、代表性第三方扩展、Desktop 集成和打包仍需验收。

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
