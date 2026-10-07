---
description: "在选定的 DSH profile 中，把旧 Cordis Settings 接到 Engine 服务，同时保持每项可选依赖按需加载。"
kind: "package-reference"
---

# @deepseek-ai/dsh-compat-settings-adapters

[English](README.md) | 中文

## 概述

本包把旧 Cordis Settings 接到 AgentLoop、默认模型选择、agent presets 和 subagent 模型选择。Profile 只选择与已挂载 Engine 服务相符的入口；每个入口在该服务原有的 Cordis Context 中注册。Engine 包按选中的入口异步加载，未选择的适配器不要求安装其 Engine 包。Settings Provider 缺席时，组合提供的值仍然生效。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Cordis profile 中，选择与对应 Engine 服务并列的适配器入口。

### 何时选择

当 Cordis profile 使用旧 Settings Provider，并挂载了对应 Engine 服务时选择该入口。Native 服务直接使用共享 Settings 定义，不加载本包。

### 最小配置

本包没有入口配置字段。Profile 将所需入口作为插件行选择；例如默认模型入口：

```yaml
- id: agent-default-model-settings
  name: '@deepseek-ai/dsh-compat-settings-adapters/agent-default-model'
```

其他入口为 `./agent-loop`、`./agent-presets` 和 `./tool-subagent`；每个入口都要求同一组合中存在匹配的 Engine 服务。只加载选中的 Engine 依赖，所选依赖缺失时会在该入口激活时记录错误。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Owner 连接——点击展开</summary>

选中的适配器先异步加载对应 Engine 包，再等待匹配的 Engine 服务，并在该服务原有的 Cordis Context 上注册 Settings。所选 Engine 依赖缺失时，入口激活会失败，不会注册服务。Engine 所有的回调继续负责校验；Settings Provider 缺席或卸载时，组合值会恢复。

| 文件 | 职责 |
|---|---|
| [`src/agent-loop.ts`](src/agent-loop.ts) | AgentLoop Settings 适配器 |
| [`src/agent-default-model.ts`](src/agent-default-model.ts) | 默认模型 Settings 适配器 |
| [`src/agent-presets.ts`](src/agent-presets.ts) | 预设选择 Settings 适配器 |
| [`src/tool-subagent.ts`](src/tool-subagent.ts) | subagent 模型选择 Settings 适配器 |
| [`src/settings-entry.ts`](src/settings-entry.ts) | Settings 适配器共用的校验与来源回调 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Cordis Settings 声明](../compat-settings-definition/README.zh.md)——旧 `Context.settings` 类型和事件。
- [Core Settings 定义](../../../../Core/settings/settings-definition/README.zh.md)——与框架无关的服务和数值类型。
- [Settings 子系统](../../../../Docs/subsystems/settings.zh.md)——共享设置行为及其所有权。
- [DSH 兼容桥](../README.zh.md)——按 profile 选择兼容包组合。

-----

<a id="model-experience"></a>
## 模型体验

间接影响：模型和预设选择的消费方负责任何面向模型的效果；适配器只连接设置值与 Engine 服务。

#### KV Cache 影响

不添加或重排请求内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 同一 Cordis 组合必须包含所选适配器对应的 Engine 服务；本包不会提供该服务。
- 本包只适配 Settings 注册；选中的 Settings Provider 负责存储与持久化。

<a id="dev-note"></a>
### 开发备注

无。
