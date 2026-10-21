---
description: "可选原生 Host 持有选定 DSH 兼容 bridge 共用的 Cordis Context。"
kind: "package-reference"
---

# @deepseek-ai/dsh-compat-dsh-runtime

[English](README.md) | 中文

## 概述

`dsh-compat-dsh-runtime` 让原生兼容 bridge 与选定的一方 DSH 插件共用一个 Cordis Context 和 vendor Loader。它只接受 Cordis 4.0.2 和 Loader 1.0.3，并在激活 Context 前检查版本；它只挂载允许列表中的插件，并由原生 runtime 释放每个 entry。原生安装未选择此包时，不会引入兼容依赖。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

仅当原生 profile 需要明确支持的 Cordis DSH adapter 时选择此包。

### 选择条件

需要现有 Cordis 服务或事件的兼容 bridge 选择此包。没有旧式 DSH 依赖的路径直接使用原生 runtime 包。

### 最小配置

原生插件接受空配置。它通过原生 profile manifest 选择，不使用 Cordis Loader 行。

| 字段 | 默认值 | 含义 |
|---|---|---|
| configuration | `{}` | 不接受用户可配置字段。 |

<a id="supported-adapter-set"></a>

### 支持的适配器集合

这组仅面向 Host 的适配器面向 RSH 0.1.5-rc.2 工作区包。统一支持记录固定 Cordis 4.0.2、Loader 1.0.3，以及 0.1.5-rc.2 版本的六个 DSH 包：`dsh-fs-local`、`dsh-fs-observation-policy`、`dsh-fs-sandbox`、`dsh-tool-fs`、`dsh-tools` 和 `dsh-system-prompt`。四个文件系统包还必须在挂载前声明记录中的 DSH runtime API 版本、角色和能力。`dsh-tools` 与 `dsh-system-prompt` 暴露 Cordis 插件，但没有 `dsh.runtime` 元数据；runtime 会检查其已安装包名和版本、验证 RSH adapter 描述符，并在启动后要求它们提供 `tools` 与 `systemPrompt` 服务。内部 adapter 是内联函数，不是 npm 包，不会伪造包版本。任意插件和应用 bundle 均不受支持。

| 原生安装器 | 旧插件挂载 | 所需原生服务 | 配置 |
|---|---|---|---|
| `compat-fs-local` | `fs-local` | `compatDshRuntime`；提供 `fs` | 本地后端 `cwd`, `diffBasisMaxBytes` |
| `compat-fs-policy` | `fs-observation-policy` | `compatDshRuntime`；提供 `fsObservationPolicy` | 空配置 |
| `compat-fs-sandbox` | `fs-sandbox`、内部 `sandbox-policy-adapter` | `compatDshRuntime`, `sandboxPolicy`；提供 `fs` | 本地后端 `cwd`, `diffBasisMaxBytes` |
| `compat-tool-fs` | `tool-fs`, `tools`, `system-prompt`、内部 `fs-adapter`, `sandbox-policy-adapter`, `fs-event-bridge` | `compatDshRuntime`, `fs`, `tools`, `promptSections`；可选 `fsObservationPolicy`, `sandboxPolicy` | 正整数 `readLimit`, `readMaxLineLength`, `readMaxBytes`, `readStreamMinSize` |

表内名称使用 `@deepseek-ai/dsh-` 前缀；内部挂载属于该 runtime 的允许列表。Provider 在同一 Cordis Context 中安装 `RshPluginHost` 和 vendor Loader，并为每个选定包创建一个 Loader entry。原生调用方可更新 entry 配置、启用或停用 entry，并移除 entry。entry 变更前，Native participant 会撤销其贡献并等待进行中的工具调用、提示词组装和文件系统策略监听器排空。Loader 完成后，participant 会根据启用的 entry 和当前服务重建贡献。原生 profile 替换是独立操作：`NativeHost.replace` 和 CLI `dsh.profile.configReload: "live"` 会在 profile 或 patch 变更后替换原生安装。不支持模块代码 HMR、任意插件、Cordis 应用 bundle 或 Client 适配器。这些安装器都不创建旧 Agent loop 或 Session writer。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

Provider 创建一个 Cordis Context，安装 `RshPluginHost` 和 Loader，并按包名跟踪允许列表中的 entry。激活前检查允许列表和已安装 manifest；激活失败时会尝试在后续排队的 Loader 操作运行前移除部分 entry。如果 participant 阻止清理，失败的 mount 会继续被跟踪，便于其 disposer 重试；系统会同时报告激活与清理错误。原生所有权会在异步激活结束前注册 Context 和 entry 清理。它只会在同一 native scope、target、observation 对象与 actor 正在 Native 和 Cordis 事件总线间同步转发时抑制相同的 `fs/observed` 回声；其他事件和监听器失败仍按原行为传播。

本包不发布运行时不变量伴生入口，因为包名映射只索引由此 Provider 发起的挂载，用于拒绝重复挂载并取得对应 Fiber 的释放函数；adapter 服务与事件仍由 Cordis Context 拥有，该映射不是其状态的第二份投影。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [原生 runtime](../../../../Core/runtime-diagnostics/native-runtime/README.zh.md)——原生生命周期与清理。
- [Plugin host](../compat-plugin-host/README.zh.md)——Cordis 描述符所有权与 adapter 生命周期。
- [架构](../../../../Docs/architecture.zh.md#cordis)——profile 组合与可选兼容 bridge。

-----

<a id="model-experience"></a>
## 模型体验

### Cordis 兼容 bridge

#### 模型看到的内容

`dsh-compat-dsh-runtime` bridge 不直接贡献模型可见内容；选定的旧式工具仍由各自 Consumer 负责提供 schema 与结果。

#### Token 影响

此包不增加提示词 token 或工具 schema。已挂载的 adapter 仍可能暴露其 Consumer 所拥有的 schema。

#### KV Cache 影响

此包不改变请求前缀，因此选择 `dsh-compat-dsh-runtime` 不会影响提供方缓存复用。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 此包不会加载 Cordis Loader profile、旧应用 bundle、任意 DSH 插件，也不会通过 HMR 加载已变化的模块代码。
- 现有 Cordis 应用 profile 仍基于 Cordis；profile 组合必须只在原生兼容路径中选择此包。
- 当前支持的 adapter 覆盖文件系统能力组；每个新增 DSH 插件都需要显式 manifest、配置映射和生命周期测试。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

允许列表由兼容 bridge 维护。只有在增加包级所有权记录与生命周期覆盖后才扩展它。

</details>
