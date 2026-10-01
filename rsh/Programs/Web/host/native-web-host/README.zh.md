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

激活通过 `dsh-native-web-assets` 准备 Client 图，通过 `dsh-client-connection/native-host` 创建一个 Host Connection registry，并通过原生 `node:http` bridge 绑定 Fetch 路由。实时模式监视 profile 目录以观察原子替换，串行准备候选，并同时更新资源表和 revision；无效候选保留当前页面。浏览器在调用 `NativeClientHost.replace` 前先加载候选样式和模块，因此替换或导入失败会保留当前 UI。后续原生 Host Provider 使用发布的 `nativeWebHost` 服务注册 RPC channel 或精确 Fetch 路由。NativeHost 拥有监听器释放器，因此会先排空路由贡献，再关闭 socket。本包不导入 Cordis Loader、旧 Web Server，也不创建第二套 Agent、Session 或 Tools 权威。

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
- 新建 `native-web` profile 启用 `clientReload: live`；其他 profile 默认使用 `startup`。该重载覆盖选中的原生 Client profile 和编译后的模块图，不提供源码级模块 HMR 或任意旧插件支持。CLI 的实时配置监视会在原生安装图变化时单独替换 Host application。参见[原生 CLI profile](../../../CLI/README.zh.md#profiles)。
- 非 loopback 绑定必须显式提供受信 authority，本身不会让监听器适合不受信网络。

<a id="dev-note"></a>
### 开发备注

无。
