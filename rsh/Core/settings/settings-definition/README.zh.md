---
description: "供设置提供方、API 与消费方共用的 Settings 接口，包含不依赖 Cordis 的 Native 服务定义。"
kind: "package-reference"
---

# @deepseek-ai/dsh-settings-definition

[English](README.md) | 中文

## 概述

本包供设置提供方与消费方共用 Settings 服务、namespace、descriptor 和编辑类型。`/types` 导出保存协议安全视图；`/native` 定义 Native 服务，并在不导入 Cordis 的情况下扩展 `NativeServices`。本包只定义接口；提供方负责存储与解析值。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

提供方与配置 API 使用根导出中的框架无关 Settings 声明。浏览器消费方使用 `/types`；Native 提供方与消费方使用 `/native`。

```ts
import type { SettingsService } from '@deepseek-ai/dsh-settings-definition'
import type { NativeSettingsService } from '@deepseek-ai/dsh-settings-definition/native'
```

这些导入只在编译期解析类型约定，不会创建 Settings 服务或加载提供方。Cordis 插件使用 [`compat-settings-definition`](../../../Compatibility/DSH/bridge/compat-settings-definition/README.zh.md) 中的 `Context.settings` 声明。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>声明所有权——点击展开</summary>

根导出定义与框架无关的 Settings 服务和注册 scope。`/types` 定义 namespace 标识及配置界面使用的 JSON 安全值。`/native` 定义 Native 存储、服务、descriptor、编辑和 scope 类型，并通过模块 augmentation 添加 `NativeServices.settings`。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 共享 Settings 提供方与消费方类型 |
| [`src/types.ts`](src/types.ts) | Namespace 标识与 Client 安全值声明 |
| [`src/native.ts`](src/native.ts) | Native Settings 接口及 Native 服务 augmentation |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Settings 子系统](../../../Docs/subsystems/settings.zh.md)——服务类型、Cordis API、Native API 与事件。
- [官方 Settings 组](../../../Modules/Official/settings/README.zh.md)——具体 Settings 实现。
- [Cordis 兼容声明](../../../Compatibility/DSH/bridge/compat-settings-definition/README.zh.md)——`Context.settings` 与注册选项。
- [Settings 声明所有权说明](../../../../.agents/notes/implemented/architecture/2026-10-07-settings-definition-ownership.zh.md)——Core 与 Compatibility 声明采用不同所有者的原因。

-----

<a id="model-experience"></a>
## 模型体验

### 提供方拥有的 Settings 值

#### What the model sees

`SettingsNamespaceView` 和 `NativeSettingsDescriptor` 用于描述配置界面；这些声明不会向模型请求添加内容。只有提供方或消费插件显式读取并应用某个 Settings 值时，它才会影响请求；该消费方负责说明模型可见约定。

#### Token effect

这些声明本身不产生影响。配置值是否改变请求内容或 Token 用量由消费方决定。

#### KV Cache effect

本包本身不产生影响。消费方若更改提示内容，则由其决定该变化是否影响提供方的缓存键。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **不包含提供方实现**——导入这些声明不会加载存储，也不会在运行时提供设置服务。
- 本包只导出服务约定，因此不发布 invariant companion；Settings 提供方负责持久化和运行时行为。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
