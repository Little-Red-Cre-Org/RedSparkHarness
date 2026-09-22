---
description: "原生 profile 可将现有 Cordis 本地文件系统 Provider 作为唯一文件系统实现来选择。"
kind: "package-reference"
---

# @deepseek-ai/dsh-compat-fs-local

[English](README.md) | 中文

## 概述

`dsh-compat-fs-local` 让原生 Consumer 使用维护中的本地文件系统后端。它在创建隔离 Cordis Context 前校验所选旧包声明和本地后端配置。bridge 提供一个原生 `fs` 服务，并在 Host 关闭期间等待其 Context 释放。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

配置采用已记录的 `dsh-fs-local` 配置，包括可选工作目录。不支持的字段会在旧 Context 启动前失败。原生 profile 不得在同一作用域选择其他 `fs` Provider。

<a id="model-experience"></a>
## 模型体验

bridge 不添加模型文本或工具。它的原生 Consumer 决定哪些文件系统结果对模型可见并持久化。

#### KV Cache 影响

不添加或重排请求内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 此 bridge 只选择 `dsh-fs-local`，不加载旧 base bundle，也不发现任意文件系统插件。
- 本地文件系统访问仍遵循所选后端的宿主文件语义。

不发布 invariant companion，因为原生 Host 生命周期诊断和聚焦 bridge 测试已观察唯一受管理的 Context。

<a id="dev-note"></a>
### 开发备注

无。
