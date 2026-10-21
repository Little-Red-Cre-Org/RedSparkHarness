---
description: "不依赖服务的共享错误码与诊断渲染。"
kind: "package-library"
---

# @deepseek-ai/dsh-errors

[English](README.md) | 中文

## 概述

这个无依赖库拥有 `HarnessError`、`isHarnessError` 和 `errorChain`。文件系统错误与模型错误共享同一个构造函数身份。LLM 包为现有消费者重新导出这些值，并继续拥有模型专用的失败分类。

## 目录

- [使用错误](#use-errors)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-errors"></a>
## 使用错误

扩展 `HarnessError` 时提供稳定的机器可读错误码和可选的标准 `cause`。按错误码路由失败；`errorChain` 仅为诊断渲染消息、嵌套原因和聚合成员，不会重复追加已包含在包装消息中的原因。它能处理循环原因和抛异常的访问器。`isHarnessError` 检查构造函数身份，因此普通对象与其他 realm 的错误不满足条件。

不发布 invariant 配套入口：错误是普通值，没有独立维护的服务状态。

<a id="model-experience"></a>
## 模型体验

无，因为这个库不构造模型请求；消费者决定在哪里显示错误诊断。

#### KV Cache 影响

不会添加或重排请求内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 序列化错误由所属传输层解码。这个包不恢复跨进程的类身份。

<a id="dev-note"></a>
### 开发备注

无。
