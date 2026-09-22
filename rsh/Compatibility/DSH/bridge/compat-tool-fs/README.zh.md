---
description: "原生 headless profile 可通过可撤销原生注册表暴露选定的旧文件系统工具与提示词指导。"
kind: "package-reference"
---

# @deepseek-ai/dsh-compat-tool-fs

[English](README.md) | 中文

## 概述

`dsh-compat-tool-fs` 将旧 read、write 和 edit 工具适配进原生工具和提示词注册表。原生应用仍是模型请求以及持久 `tool/call` 和 `tool/result` 记录的唯一所有者。bridge 将旧文件系统决策转发进原生事件，并在释放 Cordis Context 前等待已接收的工具工作。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

bridge 只接受 `dsh-tool-fs` 支持的正整数限制：`readLimit`、`readMaxLineLength`、`readMaxBytes` 和 `readStreamMinSize`。profile 必须提供 `fs`、`tools` 和 `promptSections`。当文件系统具有 sandbox mode 且存在 `sandboxPolicy` 时，旧 write 和 edit 会接收当前 Session 策略。

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型看到什么

模型收到追加到应用系统提示词的选定文件系统指导。

##### 文件系统指导

```markdown
Use the read tool to inspect a file before changing it.
```

#### Token 影响

指导会在每次请求中发送，并保留在请求前缀中。

#### KV Cache 影响

添加或移除此 bridge 会从首个不同 token 起改变系统消息前缀。

### 文件系统操作

#### 模型看到什么

模型收到选定的旧 `read`、`write` 和 `edit` schema。执行将旧结果内容返回给原生应用，应用在下一次模型请求前记录一个持久结果。

#### Token 影响

schema 会在每次请求中发送，每个工具结果保留在后续请求中。

#### KV Cache 影响

改变选定操作会从首个不同 token 起改变请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 此 bridge 只支持选定文件系统工具及其提示词 section。
- 它不加载旧 Agent loop、Session store、base bundle 或任意旧工具包。

不发布 invariant companion，因为原生应用拥有唯一持久化工具结果观测。

<a id="dev-note"></a>
### 开发备注

无。
