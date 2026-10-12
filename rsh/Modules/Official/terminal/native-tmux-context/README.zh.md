---
description: "向 Native Headless 请求加入当前 tmux 位置，并让 Session 历史在重启后保留该信息。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-tmux-context

[English](README.md) | 中文

## 概述

向 Native Headless 模型请求添加当前 tmux 会话、窗口与窗格位置。位置变化会在派发前写入 Session 历史，并在重启后恢复。随附的 Native Headless 模板默认禁用此 Provider，因为模板未安装 shell 执行器。

## 目录

- [使用本包](#use-this-package)
- [实现](#understand-the-implementation)
- [继续探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当模型请求需要包含 agent 进程当前的 tmux 位置时，在 Native profile 中安装此 Provider。

### 何时选择

当明确选择的 Native Headless profile 需要读取 tmux 位置时，选择此 Provider。没有 `shell` 服务时不会添加位置消息。兼容 Agent pre-step 路径使用单独的 `dsh-tmux-context` 包。

### 最小配置

随附 profile 已声明禁用行。此 overlay 启用该行并设置刷新下限；要读取 tmux 位置，请在同一组合安装 `shell` Provider。没有该服务时，此 Provider 不会添加位置消息：

```json
{
  "formatVersion": 1,
  "installations": [
    { "id": "tmux-context", "disabled": false, "config": { "refreshIntervalMs": 30000 } }
  ]
}
```

`refreshIntervalMs` 默认值为 `0`；正值表示已提交读取之间的最小间隔，也包括位置变化。Provider 的 [`Config`](src/index.ts) 声明列出接受的字段。

<a id="understand-the-implementation"></a>
## 实现

Provider 通过所选 `shell` 服务查询，并返回带来源信息的 user 消息。它会检查 agent 进程的控制终端是否与所选 tmux 窗格一致，然后只记录位置元数据。Native Headless 持有 Session writer，从已提交事件恢复去重状态，并在准备与取消检查后追加返回消息。

<a id="further-exploration"></a>
## 继续探索

- [tmux-context 子系统](../../../../Docs/subsystems/tmux-context.zh.md)
- [Cordis-free tmux-context Definition](../../../../Engine/context/tmux-context-definition/README.zh.md)
- [Native Headless](../../../../Engine/core/native-headless/README.zh.md)
- [兼容 tmux-context Provider](../../../../Engine/context/tmux-context/README.zh.md)
- [持久 Native tmux 位置决策](../../../../../.agents/notes/implemented/feature/2026-10-12-native-tmux-context.zh.md)

<a id="model-experience"></a>

## 模型体验

间接影响：Provider 返回消息后，由消费它的 Native 应用在模型派发前将其追加到 Session。

#### KV Cache effect

当位置与上次已提交读取不同时，这条消息会在本轮第一步加入请求。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与待办

- 查询需要 POSIX `ps` 和 `tmux`、`TMUX_PANE` 值及匹配的控制终端；否则不会添加位置消息。
- Provider 只读取位置元数据；它不会读取窗格文本、终端内容或像素尺寸。
- 由于准备只在每轮第一步执行，轮次中途的位置变化会在下一轮显示。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
