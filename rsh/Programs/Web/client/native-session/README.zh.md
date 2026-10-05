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

安装在 client-connection 之后，必须配置正整数 maxFollowBufferChars，限制 SSE 解析缓冲区。clientNativeSession 服务提供 list、create、history、prompt、cancel 与 status。提示要求显式 resume 布尔值，并在 Host 结算后完成。调用方取消会中止非提示请求；提示取消会等待 Host 结算。Host 错误以拒绝返回；解码结果在进入 Consumer 前验证端点字段。Consumer 不维护第二个 Session 缓存或连接循环。

模型控件解码选定 Host 的目录与已安装预设元数据。模型与预设修改必须携带所呈现的持久化修订号，并在 Host 维护操作结算后完成。目录不限制显式模型路由；模型 Provider 验证解析。这些方法不拥有选择缓存。

可选提示观察者通过选定 Connection 的 Fetch 响应跟随已接受的持久化事件及临时助手文本。维护中的 eventsource-parser 处理 SSE 分帧。事件解码复用共享 Session 解析器；缺少结算终止帧、帧格式错误或观察者失败都会取消确切准入，并等待 Host 排空后拒绝。调用方取消会解除跟随，仍等待持久化结算。没有 response 支持的自定义 RPC 载体在准入前拒绝带观察者的提示。

`close()` 取消当前 Client 拥有的提示并等待 Host 结算回复；原生安装器在卸载时等待该操作。

共享 Session 包是 peer，因为事件验证与格式解释使用应用的同一份 Session 实现。

提示先取得确切准入身份，再等待结算。调用方在发送前取消时拒绝准入；发送后取消使用该身份请求 Host 排空，直到持久化结算才结束 Promise。待结算轮次和结算等待者分别受 maxPendingRequests 限制，未领取的结果继续占用槽位。安装关闭取消并排空所有轮次。

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

- 完整产品 UI、附件、审批和问题交互不由该包提供。
