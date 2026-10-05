---
description: "共享的安全终端消息展示组件。"
kind: "package-library"
---

# @deepseek-ai/dsh-terminal-ui

[English](README.md) | 中文

## 概述

该库展示用户消息、模型流和工具结果。原生终端与兼容终端复用相同的 Ink 消息行和控制字符过滤。调用者提供本地化文本和已完成消息；该库不运行 Agent。

## 目录

- [使用与配置](#configuration)
- [实现](#implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 使用与配置

依赖入口导出 `ChatRow`、`StreamBlock`、类型化的 `computeViewport` 行数估算与文本工具。`./presentation` 还导出兼容终端的 `App`、`ResumePicker` 及原有辅助函数；`./utilities` 导出终端颜色和控制字符过滤工具。该库不是配置插件；调用者负责挂载与释放 Ink。消息行通过 `copy` 属性接收[类型化文本](src/copy.ts)，缺省使用英文兼容文本。

<a id="implementation"></a>
## 实现

<details>
<summary>实现细节</summary>

[消息展示](src/ui.js)保留兼容终端的格式与安全过滤，[辅助函数](src/utils.js)保持纯函数。MIT 许可来源保留在 [LICENSE](LICENSE)。未发布 invariant companion：本库没有独立的可变服务状态。

</details>

<a id="model-experience"></a>
## 模型体验

无，因为本库只展示调用者提供的文本，不修改模型请求。

#### KV Cache 影响

展示与输入队列不修改已记录的模型请求前缀；执行器拥有缓存相关请求变化。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 完整 `App` 仍面向兼容运行时的交互接口；原生应用只消费共享消息行。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
