---
description: "旧版 Settings API 的 Cordis 声明，包含 Context.settings 与注册选项。"
kind: "package-reference"
---

# @deepseek-ai/dsh-compat-settings-definition

[English](README.md) | 中文

## 概述

Cordis 插件消费旧版 `Context.settings` API 时使用本包。根导出把 Settings 服务与注册选项加入 Cordis 声明；`/events` 声明 Settings 事件类型。本包不包含 Settings 提供方或存储；Native 消费方使用框架无关的 Settings 定义。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Cordis 插件的类型声明导入根导出，以启用 `Context.settings`：

```ts
import type {} from '@deepseek-ai/dsh-compat-settings-definition'
```

`/events` 导出声明兼容 Settings 事件。这些导入只扩展 TypeScript 声明；运行时服务仍由选定的 Settings 提供方创建。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Cordis 声明——点击展开</summary>

根导出通过 `CordisSettingsService` 扩展 Cordis `Context`，该服务建立在框架无关的 `SettingsService` 之上。`/events` 导出使用共享的 namespace 与更新来源类型声明兼容事件负载。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Cordis Context augmentation 与注册选项 |
| [`src/events.ts`](src/events.ts) | Cordis Settings 事件声明 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Settings 子系统](../../../../Docs/subsystems/settings.zh.md)——共享、Cordis 与 Native Settings 声明。
- [Core Settings 定义](../../../../Core/settings/settings-definition/README.zh.md)——框架无关与 Native 接口。
- [官方 Settings 组](../../../../Modules/Official/settings/README.zh.md)——具体 Settings 提供方。

-----

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限 Cordis**——本包描述 `Context.settings`；Native 消费方改用 `dsh-settings-definition`。
- **没有运行时提供方**——这些声明不会挂载或存储 Settings 服务。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
