---
description: "为认证原生应用传输提供待回答的人类问题。"
kind: "package-reference"
---

# @deepseek-ai/dsh-user-question-broker

[English](README.md) | 中文

## 概述

向认证应用呈现待回答问题，并接受其回答。回答必须引用原 Agent 与 broker 发出的请求 id。移除最后一个接收者会取消问题；移除 Provider 会排空全部待处理呈现。本包自身不收集终端、SDK 或浏览器输入。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在原生 profile 中同时选择本包与 `@deepseek-ai/dsh-user-questions`。其 `./native` 入口依赖 `userQuestions`，提供 `userQuestionBroker`；配置为空。应用通过 `onRequest` 订阅并保留呈现中的 Agent，再通过 `answer(id, agent, answer)` 提交 JSON。无效选项会失败但不消耗问题；重复或过期回答会失败。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

入口转发 [user-questions](../user-questions/src/broker.ts) 中唯一的 broker 实现。它增加可独立选择的 Provider manifest，不增加待处理请求存储。问题 Definition 在选择 scoped 回答者前验证存活根的所有权。移除 Provider 会取消其已接受的回答，并等待结算。

不发布运行时 invariant companion：broker 拥有一个 pending map，没有可与之对照的独立持久观察。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [问题 Definition](../user-questions/README.zh.md)：准确执行所有权与共享协议。
- [模型侧工具](../tool-ask-user/README.zh.md)：记录问题结果。
- [原生运行时](../../../../Core/runtime-diagnostics/native-runtime/README.zh.md)：安装所有权。

<a id="model-experience"></a>
## 模型体验

通过 `ask_user_question` 间接体现：Program 将接受的回答或取消错误记录为普通工具结果。

#### KV Cache 影响

不直接失效；工具 Consumer 拥有可见 schema 与结果。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 提问前必须有传输订阅；没有接收者时 broker 委托给另一个回答者。
- 存活委托调用不能提问。恢复为根的历史子 Session 可以提问。
- 认证与路由由消费应用负责；此 Provider 不提供 wire server 或 UI。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景——点击展开</summary>

参见[原生人类问答决策](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-human-questions.zh.md)。

</details>
