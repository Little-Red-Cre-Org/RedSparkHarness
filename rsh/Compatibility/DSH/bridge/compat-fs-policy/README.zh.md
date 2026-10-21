---
description: "原生文件系统事件可使用现有观察策略，而不重复决策或观察权威。"
kind: "package-reference"
---

# @deepseek-ai/dsh-compat-fs-policy

[English](README.md) | 中文

## 概述

`dsh-compat-fs-policy` 将旧文件系统观察策略应用于原生 `fs/*` 事件。它把决策和观察从原生代码转发到共享 Cordis Context，保留逐 Session 的已见状态和陈旧版本防护。移除 bridge 只会移除它自己的监听器和状态。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

bridge 不接受配置字段。它提供 `fsObservationPolicy`，所以原生 profile 无法在一个作用域同时选择它和原生 observation-policy Provider。

<a id="model-experience"></a>
## 模型体验

策略会改变被接受的文件系统变更，但自身不会添加模型提示词或工具结果。

#### KV Cache 影响

不添加或重排请求内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 只支持原生到旧实现的事件转发。
- bridge 适配所选观察策略，不挂载无关旧插件。

不发布 invariant companion，因为原生事件订阅及其旧 Context 只有一个所有者。

<a id="dev-note"></a>
### 开发备注

无。
