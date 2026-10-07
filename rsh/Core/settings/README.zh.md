---
description: "Core Settings 组地图：供设置提供方与消费方共用的框架无关服务声明与 Native 声明。"
kind: "package-group"
---

# rsh/Core/settings

[English](README.md) | 中文

## 概述

Core Settings 组为设置提供方、API 与消费方提供共享声明。`settings-definition` 拥有框架无关服务类型和 Native 服务 augmentation。Compatibility 组拥有 Cordis 声明；具体存储与解析仍由选定的 Settings 提供方负责。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 |
|---|---|
| [`settings-definition`](settings-definition/README.zh.md) | 共享 Settings 服务、协议与 Native 声明 |

<a id="related-documentation"></a>
## 相关文档

- [Settings 子系统](../../Docs/subsystems/settings.zh.md)——共享、Cordis 与 Native 服务声明。
- [Compatibility bridge 组](../../Compatibility/DSH/bridge/README.zh.md)——被选用的 Cordis 扩展。
- [官方 Settings 组](../../Modules/Official/settings/README.zh.md)——Settings 提供方与消费方。

<a id="dev-note"></a>
## 开发备注

无。
