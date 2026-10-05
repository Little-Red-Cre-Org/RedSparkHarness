---
description: "原生模型流与 Session 步骤中的持久助手事件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-model-execution

[English](README.md) | 中文

## 概述

`dsh-native-model-execution` 为安装流式 `model` Provider 的原生 Host profile 提供 `modelExecution`。Consumer 提供模型可见输入已持久化的 Session 步骤。服务通过共享 LLM assembler 处理一条模型请求流，并在返回终止原因前持久化 `assistant/message`。取消或无效的流会追加 `assistant/attempt`；调用方的 Session 关闭路径负责持久化这条部分记录。

## 目录

- [配置](#configuration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制和后续工作](#known-limitations-and-deferred-work)

<a id="configuration"></a>
## 配置

`./native` Provider 不接受配置。`execute` 调用需要开放的 Session、turn 与 step 编号、`GenerateOptions`，以及由 Session writer 拥有的追加和持久化回调。调用方负责构建请求、执行工具、关闭 turn 及管理存储生命周期。模型流必须以一条终止 `finish` 结束，之后不能再输出 chunk。终止原因为 error 或 aborted 时，服务记录 attempt 后让步骤失败。

可选 `onChunk` 观察者接收同一次 dispatch 已接纳的流块。观察者失败会中断尝试并保留其已记录的部分流；观察者不会创建另一次模型请求或另一个 writer。

<a id="dev-note"></a>
## 开发备注

本包不提供 invariant companion：服务把模型流写入调用方的 Session，没有可能与之独立偏离的另一份观察。

<a id="model-experience"></a>
## 模型体验

### 助手流

#### 模型看到的内容

只有持久化的 `assistant/message` 事件完成 flush 后，返回的助手消息才会出现在后续请求中。失败的 `assistant/attempt` 不进入模型历史。

#### Token 影响

服务不增加输入 token；后续请求可能包含已提交的助手内容。

#### KV Cache 影响

服务不改变请求前缀；后续缓存影响取决于持久化的助手内容。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和后续工作

- 调用方仍拥有 turn 与 step 的顺序。原生 SDK 与 Web Consumer 尚待迁移。
- 仓库过渡期间，本包 manifest 及 Session、LLM 依赖仍保留 Cordis。
