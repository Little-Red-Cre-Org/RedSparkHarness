---
description: "面向发送官方 DeepSeek 请求的部署，说明活跃 Loader 包清单元数据。"
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-package-inventory-deepseek

[English](README.md) | 中文

## 概述

用于 DeepSeek 官方 LLM API 请求的完整包清单。Cordis 入口读取活跃 Loader 包；Native Host 入口读取 [`NativePluginInventory`](../../../../Core/runtime-diagnostics/native-runtime/README.zh.md#package-provenance) 中就绪且有包来源的安装。两者都通过 `deepseekLlmApiExtensions` 贡献 `dsh_plugin_packages`。

## 目录

- [配置](#configuration)
- [Native Host 入口](#native-host-entry)
- [收集](#collection)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="configuration"></a>
## 配置

| 配置键 | 默认值 | 含义 |
|---|---:|---|
| `enabled` | `true` | 注册 `dsh_plugin_packages` 贡献。将其设为 `false` 可省略包元数据。 |

随附 profile 使用该默认值，因此只要准备成功，每个 DeepSeek 官方请求都会携带包清单。

<a id="native-host-entry"></a>
### Native Host 入口

`./native` 入口要求 `deepseekLlmApiExtensions`、`pluginInventory` 与 `activeSessions`。请求的 `sessionId` 匹配活动 Session 时使用其所有者 Agent 的作用域；否则由此贡献插件从自身安装作用域读取。只有该作用域及其祖先中就绪且有包来源的安装会贡献其 manifest 的 `name` 与 `version`。这是显式 Native 能力；随附 profile 继续使用 Cordis 入口。

<a id="collection"></a>
## 收集

每次请求都会重读宿主 Loader 树中的活跃非 group 配置项。存在可选 `ctx.agentPresets` 且 `sessionId` 解析到已加入 standing preset 的存活 Agent 时，该 preset 的独立 Loader 树也会加入同一次收集；未挂载该服务的部署只报告宿主树。只有根 fiber 处于 `ACTIVE` 且 Loader 有效状态为启用的配置项才会纳入。

裸包与包子路径 specifier 通过 Node 包搜索路径解析，无需包导出 `./package.json`。每个普通配置项使用其所属 Loader 树的基址。standing preset 的根配置项使用宿主基址，与 preset Loader 对裸包的显式覆写保持一致；嵌套 include 仍使用自身基址。相对与绝对模块会向上查找最近的 manifest（元数据清单）；没有 `name` 的 manifest 只标记松散模块，不贡献包身份。具名包 manifest 还必须声明非空 `version`，格式错误的包元数据会使请求准备失败。系统使用与 locale 无关的比较按确切名称／版本对去重并排序，同时存活的不同版本仍会分开保留。

版本 1 的 `dsh_plugin_packages` 字段只包含 `{ name, version }` 对。系统会排除禁用、pending、failed、disposed、unloading 状态，结构性 `cordis:` 配置项，普通依赖，没有所属包身份的松散文件，以编程方式挂载的子 fiber，以及内存动态插件。

<a id="model-experience"></a>
## 模型体验

### 包清单元数据

#### 模型看到的内容

无。`dsh_plugin_packages` 是位于模型消息、系统提示词与工具 schema 之外的提供方元数据。

#### Token 影响

模型输入 token 为零；完整清单只会增加 HTTP 请求字节数。

#### KV Cache 影响

无；包生命周期变化不会改变模型可见前缀。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **Cordis Loader 清单不含无来源 fiber**——以编程方式创建的子 fiber 与内存动态插件没有权威 NPM 名称／版本来源；Native 入口则读取有包来源的 Native 安装。
- **省略松散模块**——没有具名且带版本所属 manifest 的相对文件是插件模块，不是插件包。
- **Cordis 包替换需要重启**——Cordis 入口会在进程存活期内缓存 manifest 身份。Loader 的启用、禁用、挂载、卸载与普通源码 HMR 会刷新其活跃配置项集合，但在同一进程中把已挂载包的 manifest 替换为另一版本并不是受支持的升级路径。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。Cordis 请求读取权威 Loader fiber 状态与 package manifest；Native 请求读取 `NativePluginInventory`。两个入口都不保留独立可变 inventory。
