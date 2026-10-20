---
description: "Native 激活可以创建一个 Cordis 上下文，并翻译插件所读的服务，从而托管一个 Cordis 插件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-cordis-bridge

[English](README.md) | 中文

## 概述

`dsh-cordis-bridge` 在一次 Native 激活里托管一个 Cordis 插件。它创建 Cordis 上下文，提供该插件读取的服务，并随 Native 行销毁该上下文。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

`hostCordisPlugin` 接收 Cordis 插件、它的配置，以及它可以读取的服务对象。`nativePluginForCordis` 把这个宿主包装成 Native 插件。`requires` 必须与包的 native 清单一致。

该包拥有 Cordis 上下文，但不拥有服务。调用方翻译自己的 Cordis 插件所读的 Native 服务，并把翻译后的集合交给宿主；`@deepseek-ai/dsh-native-persona` 发布 persona 的翻译。

<a id="model-experience"></a>
## 模型体验

间接。被桥接的插件通过调用方翻译出的服务贡献模型可见内容。消费方应用渲染并记录结果。

#### KV Cache effect

消费方应用拥有被桥接贡献引起的请求前缀变化。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 目前只交付 persona 的翻译。其他 Cordis 行需要各自的翻译，Native 预设才能托管它们。
- 每个 Native 行只运行一个 Cordis 插件。

不发布 invariant 伴随包。桥接层不拥有可以由独立观察发生分歧的关系。

<a id="dev-note"></a>
### 开发备注

无。
