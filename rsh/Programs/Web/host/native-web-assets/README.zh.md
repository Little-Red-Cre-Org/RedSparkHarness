---
description: "Desktop 原生 Client 页面和已编译资源可从已安装运行时提供，无须 Cordis 服务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-web-assets

[English](README.md) | 中文

## 概述

`dsh-native-web-assets` 解析已安装的前端，提供选中的原生 Client 页面及 Host 编译的资源，并将静态文件读取限制在前端分发目录。`listenNativeHttpHost` 增加了无 Cordis 的 node:http 载体：绑定共享 Connection registry，认证 `/api` 与已注册 RPC channel，并负责监听器销毁。现有 Desktop Host 使用相同路由提供可选的原生预览。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

`createNativeDesktopAssetHandler(runtimeDir, nativeClient, transportScript)` 要求安装包含 `dist/native.html` 的 `@deepseek-ai/dsh-web-frontend` 分发包，提供已校验的 Client bundle 和 Host 自有浏览器传输脚本；它不要求 `dist/index.html`。它的 `update(bundle)` 会为实时 Host 原子发布完整替换资源表。它在 `/`、`/index.html`、`/native.html` 及未匹配的应用路径提供原生页面；已编译的 Client 资源只来自所给资源表。它支持 `GET` 和 `HEAD`，对旧 `/plugins/` 请求返回 404，并拒绝解码后或经符号链接指向前端分发目录外的静态路径。`listenNativeHttpHost(registry, assets, bridge, config)` 默认绑定回环监听器，将 `/api` 与已注册 channel 交给共享 Connection 策略，并提供 `close()` 做确定性销毁。组合 Host 显式注入原生 Connection bridge。`createDesktopAssetRoutes` 将相同的原生和静态路由提供给兼容 Host，后者还要求 `dist/index.html` 并拥有 `/plugins/` 端点。

`prepareNativeClientBundle` 返回编译资源和仅供 Host 使用的输入目录，以便实时观察。构建失败时会报告这些目录，并为未解析的包导入包含现有的 `node_modules` 位置，使 Host 可以在缺失的导入恢复后重新构建，而不发布不完整的图。

<a id="model-experience"></a>
## 模型体验

无，因为此包只提供浏览器资源，不创建模型请求内容。

#### KV Cache 影响

无。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 此包不选择 Client profile，也不编排完整的原生 Web 应用；调用者需要提供 registry 和选中的资源 bundle。
- 受支持的产品 Client 名册尚未迁至原生页面；兼容 Host 仍默认提供旧版应用。

不发布 invariant companion，因为路由响应由已安装的前端和提供的不可变 bundle 推导，不存在独立的持久状态。

<a id="dev-note"></a>
### 开发备注

无。
