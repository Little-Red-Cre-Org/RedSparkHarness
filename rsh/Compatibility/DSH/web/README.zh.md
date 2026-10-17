---
description: "DSH 兼容 Web 包组：旧版 Cordis 浏览器外壳及其独立 worker-preview 构建。"
kind: "package-group"
---

# DSH 兼容 Web 包

[English](README.md) | 中文

## 概述

兼容 Web 包组让仍通过旧版模块表选择 Client 插件的 Host 保留现有 Cordis 浏览器外壳。其 frontend 包从共享应用源码构建独立兼容页面和 worker preview。Native Web 包仍是默认的无 Cordis 浏览器分发。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

Host 需要现有 Cordis 页面与模块路由时，使用兼容 frontend。

| 包 | 职责 |
|---|---|
| [`frontend/`](frontend/README.zh.md) | 旧版浏览器外壳和私有 worker-preview 构建 |

<a id="related-documentation"></a>
## 相关文档

- [Native Web 包决策](../../../../.agents/notes/implemented/architecture/2026-10-17-native-web-default-and-compatibility-browser-owner.zh.md)——区分默认 Native 页面与兼容页面 owner。
- [Web Client 架构](../../../Docs/subsystems/web-client.zh.md)——说明本包使用的 Cordis 浏览器模块表。
- [Native Web Client 包](../../../Programs/Web/client/web/README.zh.md)——无 Cordis 浏览器组合 API。

<a id="dev-note"></a>
## 开发备注

无。
