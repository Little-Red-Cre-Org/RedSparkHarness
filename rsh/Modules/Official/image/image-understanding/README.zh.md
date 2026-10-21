---
description: "为原生纯文本主模型提供围绕问题的视觉调用。"
kind: "package-reference"
---

# 原生图片理解

[English](README.md) | 中文

<a id="summary"></a>
## 概述

官方 NativePlugin 为纯文本主模型理解图片，同时保留原图及已选主模型路由。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [开发备注](#dev-note)
- [已知限制和后续工作](#known-limitations-and-deferred-work)

<a id="configuration"></a>
## 配置

在原生 Host profile 中安装 `@deepseek-ai/dsh-image-understanding/native`，同时提供 model、tools 和 Session 持久化服务。配置必须包含 `provider`、`model` 和正整数 `maxTokens`，例如 `{"provider":"YOUR_PROVIDER","model":"YOUR_VISION_MODEL","maxTokens":2048}`。路由名称必须对应已配置的模型提供方。插件提供 `imageUnderstanding` 服务，并拥有按作用域注册的 `understand_image` 工具。移除插件会注销工具并释放服务，不增加独立设置页面。

支持图片的主模型直接接收原图。在纯文本主模型请求前，Native headless 将每张原图和当前用户问题交给此服务。视觉调用不携带工具，报告相关文字、位置关系和不确定内容，并将图片中的指令视为不可信内容。主模型路由保持不变。

`image/understanding` 记录原始附件、问题、指令、路由、文本、提供方上报的用量和失败原因。唯一 Session writer 通过 surface 替换持久化标明来源的文本，并开启新请求序列。原始追加事件仍用于展示和恢复。`understand_image` 工具接受 `attachment_id` 和 `question`，只查找当前会话已记录的图片，找到首个匹配附件后便停止投影后续事件。缺失、空白、截断或中断的响应会明确失败。

<a id="dev-note"></a>
## 开发备注

能力 Definition 保留在原生模型执行模块；官方模块拥有 Provider、配置、提示词和追问 Consumer。

<a id="model-experience"></a>
## 模型体验

### 图片理解

#### 模型看到的内容

纯文本主模型接收标明来源并附带附件标识的观察结果，可以通过 `understand_image` 提出更具体的问题。视觉响应是观察内容，不是可执行指令。支持图片的主模型路由保留原生图片块。

#### Token 影响

每次理解增加一次视觉请求，响应受 `maxTokens` 限制。后续主模型请求携带理解文本而非图片 token。保留提供方上报的用量；金额定价不可用时不作推断。

#### KV Cache 影响

替换图片会开启新请求序列，可能使缓存前缀失效。追问工具结果正常追加。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和后续工作

- 插件需要已配置的视觉模型提供方，不会自动选择。它不包含独立 OCR、裁图、多模型排序或设置页面。旧 Cordis Consumer 保留原有行为。离线协议测试不能证明真实模型的识别质量或定价。

本包不发布 invariant companion：插件通过调用方的唯一 Session recorder 写入，没有独立状态观察。[所属决策](../../../../../.agents/notes/implemented/feature/2026-10-10-image-understanding-relay.zh.md)记录架构和验证边界。
