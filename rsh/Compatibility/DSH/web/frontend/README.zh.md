---
description: "运行使用现有 Client 模块表的旧版 Cordis 浏览器外壳。Desktop Host 可提供构建后的页面，同时让 Native Web 保持无 Cordis。"
kind: "package-library"
---

# @deepseek-ai/dsh-web-compatibility

[English](README.md) | 中文

## 概述

Desktop Host 可通过本包继续提供 Cordis 浏览器外壳及其现有 Client 模块表。本包导出 `AppWebEntry`，并从共享应用源码构建旧版页面和仓库 worker preview。默认的无 Cordis 浏览器分发应使用 Native Web 包。

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

现有 Host 需要提供兼容页面并让 `/plugins/*` 继续走 Cordis 模块路由时，DesktopHost 会使用本包。

### 何时使用

当现有 Host 通过 Client 模块表选择 Cordis 插件时，使用兼容页面。Host 提供 Native 模块选择并需要无 Cordis 页面时，使用 `@deepseek-ai/dsh-web-frontend`。

### 入口

最小导入会创建浏览器入口；Host 在调用 `run()` 前提供挂载点和 loader 全局对象。

```ts ignore-check
// Client-only entry: the Host aggregate cannot compile this package's Client declarations.
import { AppWebEntry } from '@deepseek-ai/dsh-web-compatibility'

const entry = new AppWebEntry(document.getElementById('root')!)
void entry.run()
```

应用挂载或启动页报告失败后，`run()` 会完成。Host 若在独立页面嵌入此入口，必须从该页面的浏览器入口导入 `@deepseek-ai/dsh-client-web/base.css`。

运行 `pnpm --filter @deepseek-ai/dsh-web-compatibility run build` 构建 `dist/index.html`。运行 `pnpm --filter @deepseek-ai/dsh-web-compatibility run build:preview` 构建 worker preview。`pnpm run build:web` 会依次构建 Native 和兼容分发包。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

页面使用共享应用源码，本包拥有 Cordis 启动入口和静态模块表。DesktopHost 选择要提供的页面并处理兼容模块路由。Worker preview 使用单独的 Vite 入口和 VFS image。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 兼容外壳导出 |
| [`src/boot.ts`](src/boot.ts) | `AppWebEntry` 启动与 loader 交接 |
| [`src/platform.ts`](src/platform.ts) | Cordis 与静态 Client 模块表 |
| [`vite.config.ts`](vite.config.ts) | 兼容页面和 worker-preview 产物 |
| [`../../../../Programs/Web/application/legacy.html`](../../../../Programs/Web/application/legacy.html) | 基于共享应用源码的旧版浏览器入口 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

阅读 Desktop 与 Native 包文档，为应用选择浏览器 owner。

- [Desktop 应用](../../../../Programs/Desktop/README.zh.md)——拥有桌面运行时与 Host 集成。
- [Native Web 包](../../../../Programs/Web/client/web/README.zh.md)——无 Cordis 浏览器启动 API。
- [Client 组图](../../../../Programs/Web/client/README.zh.md)——展示共享浏览器包。

-----

<a id="model-experience"></a>
## 模型体验

无。兼容浏览器外壳负责呈现产品 UI，不贡献模型请求内容。

#### KV Cache 影响

无；本包不组装提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

Worker preview 的浏览器文件系统不提供 SQLite，因此不支持持久任务调度。

- **Worker preview 已禁用任务调度**——私有 worker 平台不提供 SQLite 持久化。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：**本库没有可独立变化的注册表或持久状态，因此不发布 companion。
