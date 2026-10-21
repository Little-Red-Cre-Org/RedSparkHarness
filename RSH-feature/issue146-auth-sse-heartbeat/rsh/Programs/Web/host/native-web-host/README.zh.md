---
description: "在认证的原生 HTTP Host 后运行选定的无 Cordis Web Client profile。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-web-host

[English](README.md) | 中文

## 概述

`dsh-native-web-host` 在一个认证的 `node:http` 监听器后运行选定的原生 Web Client profile。它准备 Client bundle，从原生凭据创建共享 Host Connection registry，并发布一个 Native Runtime application 与 Host 服务。本包提供载体和生命周期；领域 API Provider 仍需在共享 Connection 权威上注册自己的 channel。

本包不发布 runtime invariant companion，因为 carrier 的权威保证是路由认证、所拥有 listener 的清理和原生组合测试。

## 目录

- [配置](#configuration)
- [实现说明](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="configuration"></a>
## 配置

原生 profile 使用 `projectDir` 和 `runtimeDir` 选择本包。`projectDir` 包含 `rsh.client.json`；`runtimeDir` 包含已安装的 `@deepseek-ai/dsh-web-frontend` 分发包和选中的原生 Client 包。可选的 `transportScript`、监听器 `host` 与 `port`、请求大小上限、受信 authority、浏览器 cookie 生命周期和 `clientReload` 模式都会在激活前校验。`clientReload: live` 监视 profile 文件，完整构建候选图，并且只在构建成功后通过认证的 `/api/native-client/reload` 路由发布。监听器默认绑定 loopback 并请求操作系统分配端口；application 打印带令牌的 URL 后等待 NativeHost 关闭信号。

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现细节——点击展开</summary>

激活通过 `dsh-native-web-assets` 准备 Client 图，通过 `dsh-client-connection/native-host` 创建一个 Host Connection registry，并通过原生 `node:http` bridge 绑定 Fetch 路由。领域 Provider 在 `hostConnection` 上注册 RPC channel 和精确 Fetch 路由；监听器使用同一个 handle。`nativeWebHost` 暴露 HTTP 载体，两项服务都不会创建第二个 registry。实时模式观察 Client 源码依赖，并同时发布完整的重建资源与 revision。构建失败时保留当前页面。NativeHost 在关闭时等待 watcher、路由和监听器结束。本包不导入 Cordis Loader 或旧 Web Server。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [原生 Web 资源](../native-web-assets/README.zh.md)——Client bundling、页面注入和静态路由约束。
- [Client Connection](../../client/connection/README.zh.md)——认证、RPC channel 和 Host/Client 传输约定。
- [原生运行时](../../../../Core/runtime-diagnostics/native-runtime/README.zh.md)——安装依赖和可等待的清理。

<a id="model-experience"></a>
## 模型体验

### 原生 Host

#### 模型看到的内容

本包不会产生模型可见内容。所有模型请求和 `Session` 事件都由原生领域 Provider 负责。

#### Token 影响

无。

#### KV Cache 影响

无。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 本包只提供 HTTP 载体和 Client 启动；原生领域 Provider 仍需提供 Session、Agent、工具及其他产品 API channel。
- `clientReload: live` 观察已编译的输入、相对导入目录及未解析的包位置，不跟随符号链接。重建失败时保留已发布的资源、wire 和 revision；关闭时等待 watcher 和已接受的构建结束。这是 Client 图替换，不是旧插件 HMR。CLI 会在其 profile 变化时另行替换 Host 安装图。参见[原生 CLI profile](../../../CLI/README.zh.md#profiles)。
- 非 loopback 绑定必须显式提供受信 authority，本身不会让监听器适合不受信网络。

<a id="dev-note"></a>
### 开发备注

无。
