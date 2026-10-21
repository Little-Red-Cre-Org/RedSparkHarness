---
description: "原生 Agent 注册、作用域生命周期事件与异步 initiator 归属。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-agent

[English](README.md) | 中文

## 概述

`dsh-native-agent` 为原生 Host profile 提供 `agents` 能力。它在子原生作用域中登记存活 Agent 标识，跨异步工作保留每个显式 initiator，并在注册表释放前等待已接收的 initiator 工作结束。Agent 开始释放后，标识会变为不可用、排空已登记的清理工作，再触发配对的释放事件。它不拥有 Session，也不实现 Agent loop。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

`./native` 入口只接受空配置对象，并提供 `agents`。`NativeAgentId()` 会拒绝重复的存活标识，在 Agent 作用域中触发 `agent/created`，并返回只释放该条目的幂等 disposer。`onDispose()` 只接受精确且仍可用的 Agent 的清理项；释放会先停止后续查找和清理项登记，排空已有回调后才触发 `agent/disposed`。创建监听器失败时，注册表会移除该条目并触发配对的释放事件，再把失败交给调用者。

`withInitiator()` 和 `withoutInitiator()` 保留原始同步值或返回的原生 Promise。它们不会从安装或注册 owner 推断身份。`dispose()` 拒绝新的 initiator boundary，等待已返回的 Promise boundary，再使 initiator 读取失效并释放剩余注册项。显式注销会在 Host 事件 bus 仍接收投递时触发事件；Host 关闭会在 Provider 清理前关闭该 bus，因此其剩余条目会在不分发的情况下释放。在一个 boundary 内发起释放的操作不能在该 boundary 内等待同一次释放。

<a id="model-experience"></a>
## 模型体验

只有消费应用将 Agent 的 Session 事件、工具 schema 与结果放入模型请求时，才会间接影响模型。

#### KV Cache 影响

Agent 标识和 initiator 归属不会增加模型请求内容。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 注册表不创建 Session、不执行模型 turn、不授权工具，也不调度子 Agent。
- 生命周期事件限定在 Host 内，不提供 RPC 或浏览器 projection。

不发布 invariant companion，因为注册表的内存生命周期没有独立的持久化观测可供核对。

<a id="dev-note"></a>
### 开发备注

无。
