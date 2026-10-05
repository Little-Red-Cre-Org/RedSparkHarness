---
description: "Pure shared Subagent descriptors, assistant-output folding and delegation permission text."
kind: "package-reference"
---

# @deepseek-ai/dsh-subagent-protocol

[English](README.md) | 中文

## 概述

共享的纯 Subagent 描述符、助手输出归并与委派权限文本。

## 目录

- [Configuration](#configuration)
- [Ownership](#ownership)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## 配置

根导出、descriptor 和 assistant-output 叶子无需运行时安装。原生与 Cordis 消费者使用相同描述符载荷、输出归并、相邻 Agent 归属与初始可持续引导。

<a id="ownership"></a>
## 所有权

描述符记录子任务模式、选定提供者与标签。输出归并消费已接受的 Session 事件，保留真实最终或部分助手内容。它不创建 Session、写入器或执行。

<a id="model-experience"></a>
## 模型体验

### 委派输入

#### 模型看到什么

导出的 `SUBAGENT_DELEGATION_CONTEXT` 文本约束子任务权限范围。消费执行器必须通过其提示权威渲染并记录该文本。

#### Token 影响

描述符与归并不增加模型输入。渲染委派文本消耗提示 token。

#### KV Cache 影响

归并不改变请求前缀；消费执行器负责提示位置。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 执行、所有权与取消由消费 Program 和服务提供者负责。
- 不发布 invariant 配套模块，因为此包没有可变注册表或生命周期。

<a id="dev-note"></a>
### 开发备注

[原生派生所有权](../../../../.agents/notes/implemented/architecture/2026-10-05-native-subagent-spawn.zh.md)。
