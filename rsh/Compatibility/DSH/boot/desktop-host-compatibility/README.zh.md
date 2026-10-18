---
description: "为显式选择旧 Cordis profile 的 Desktop Host 提供私有兼容装配，包括 Fetch 路由与 Native profile 拒绝行为。"
kind: "package-library"
---

# @deepseek-ai/dsh-desktop-host-compatibility

[English](README.md) | 中文

## 概述

这个私有包为显式选择 Cordis 的 profile 提供 Desktop 组装的兼容 Host。`createLegacyDesktopRuntime` 会启动所选旧插件组合，并返回处理 API、页面资源与流式路由的 Fetch handler。profile 选择与 Native 启动由 Desktop 负责；本包会拒绝包含 `rsh.client.json` 的项目。

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

### 何时使用

只有已安装 profile 选择 legacy runtime 时，DesktopHost 才会导入此私有装配。Native profile 使用 Native Host，不会加载此包。

### 入口

DesktopHost 选择兼容装配后会提供已安装 runtime 与项目目录：

```ts
import { createLegacyDesktopRuntime } from '@deepseek-ai/dsh-desktop-host-compatibility'

const runtimeDir = '/path/to/installed/dsh'
const projectDir = '/path/to/desktop-project'
const runtime = await createLegacyDesktopRuntime(runtimeDir, projectDir, false)
```

返回的 `fetch` handler 会为所选 profile 提供 API 与页面资源；`dispose` 会拆卸其 Cordis 服务。若项目包含 `rsh.client.json`，启动会拒绝，以便 Native Client 路由继续由 Native Host 持有。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

Host 会将所选旧 profile 与 Desktop 拥有的路由和流处理组合起来。它使用兼容前端生成的页面以及共享 HTTP-routes 注入渲染器。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 私有包入口 |
| [`src/legacy-host.ts`](src/legacy-host.ts) | 旧 profile 启动、API 与流处理器，以及拆卸 |
| [`src/web-assets.ts`](src/web-assets.ts) | 兼容页面与资源路由 |
| [`src/runtime.ts`](src/runtime.ts) | 返回给 DesktopHost 的 Fetch 与拆卸接口 |
| [`config/desktop.cordis.patch.yml`](config/desktop.cordis.patch.yml) | Desktop 拥有的 Cordis 路由组合 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Desktop](../../../../Programs/Desktop/README.zh.md)——profile 选择与 runtime 装配。
- [DesktopHost 入口](../../../../Programs/DesktopHost/src/index.ts)——选择此包的进程所有者。
- [app-boot](../app-boot/README.zh.md)——profile 加载、patch 组合与启动生命周期。
- [兼容前端](../../web/frontend/README.zh.md)——此 Host 提供的页面。
- [HTTP routes](../../../../Core/util/http-routes/README.zh.md)——共享注入渲染器。

-----

<a id="model-experience"></a>
## 模型体验

通过所选旧插件树间接影响模型；模型可见内容由该插件树负责，本 Host 适配器不会添加模型输入。

#### KV Cache 影响

此 Host 不添加请求前缀。缓存行为由所选 profile 及其模型 Provider 决定。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 包含 `rsh.client.json` 的 profile 必须使用 Native Host，本兼容 runtime 会拒绝它。
- 不发布 invariant companion：本组装通过 app-boot 挂载所选旧插件树，这些关系已由其所有者持有；Host 自身只把 Fetch 请求路由到该树，没有可独立比对的可变状态。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
