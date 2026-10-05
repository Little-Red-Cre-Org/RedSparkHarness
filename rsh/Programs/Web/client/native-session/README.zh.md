---
description: "原生 Web Session 生命周期的共享执行与浏览器传输。"
kind: "package-reference"
---

# 原生浏览器 Session

[English](README.md) | 中文

## 概述

该不依赖 Cordis 的 Client Consumer 通过选定的 Connection RPC Provider 提供原生 Web Session 生命周期。

## 目录

- [参考](#reference)
- [不变量](#invariants)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)
- [模型体验](#model-experience)

<a id="reference"></a>
## 参考

以空配置安装在 client-connection 之后。clientNativeSession 服务提供 list、create、history、prompt、cancel 与 status。提示要求显式 resume 布尔值，并在 Host 结算后完成。调用方取消会中止对应传输；安装取消也会中止尚未完成的调用。Host 错误以拒绝返回；解码结果在进入 Consumer 前验证端点字段。Consumer 不维护第二个 Session 缓存或连接循环。

共享 Session 包是 peer，因为事件验证与格式解释使用应用的同一份 Session 实现。

<a id="invariants"></a>
## 不变量

本包没有可与 Host 权威分歧的独立状态，因此不发布不变量安装器。

<a id="dev-note"></a>
## 开发备注

原生 Session 执行器拥有持久化与 Agent；该包只拥有传输操作。

<a id="model-experience"></a>
## 模型体验

### 人工输入

#### 模型看到什么

只有提交的人工文本通过 Host 执行器进入模型输入；本包不贡献模型工具或提示段。

#### Token 影响

`session/prompt` 的 `prompt` 文本作为普通用户消息计入当前及后续恢复请求。

#### KV Cache 影响

该包不改变历史前缀；新增用户消息延长请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- 增量事件跟随、完整产品 UI、附件、审批和问题交互不由该包提供。
