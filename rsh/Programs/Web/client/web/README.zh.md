---
description: "Cordis-free Native 浏览器启动 API 与无框架进度页，供 Host 组合选中的 Client 插件。"
kind: "package-library"
---

# @deepseek-ai/dsh-client-web

[English](README.md) | 中文

## 概述

`dsh-client-web` 提供无 Cordis 的浏览器 API，用于导入选中的 Native Client 行、在 `NativeHost` 中安装它们并挂载必需的渲染器。无框架启动页会在渲染器挂载前报告进度与失败。包根和 `./native` 导出相同的 Native API；`./native-wire` 仅导出 Host 注入数据的类型声明。本包不包含 Cordis Loader 或兼容模块表。模型永远看不到本包。

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

Host 准备了 Client 行和浏览器模块图后，可调用 `bootNativeClient`。该调用会导入每个已选模块，校验其 Native plugin 导出，解析组合并挂载必需的 `clientRenderer`。返回的 host 拥有组合生命周期：导航或关闭时调用并等待 `stop()`；热重载时使用完整的新选择与模块图调用 `replace()`。

可选的 `AbortSignal` 会在待处理导入完成后阻止插件激活，并在中止时停止已启动的组合。`./boot-page` 导出共享的无框架启动页；`./base.css` 导出浏览器基础样式。`@deepseek-ai/dsh-web-compatibility` 拥有 `AppWebEntry`、Cordis Loader 启动和共享模块表。默认 Web `index.html` 使用 Native API，而兼容包分别构建旧版页面和 worker preview。

外壳基础样式会在支持的浏览器中为普通内容自动添加中西文间距。语义化代码以及终端、diff、读取和搜索输出容器会保留源码中的原始间距和列对齐；不支持 `text-autospace` 的浏览器会忽略这两项声明。

### 启动过程是怎样的

Host 提供模块清单、导入操作和选中的安装行。`bootNativeClient` 导入选中的行，校验 Native plugin 导出，解析完整安装并启动带渲染器挂载插件的单个 `NativeHost`。`replace()` 会先导入并解析后继组合再替换当前安装；导入或解析失败时当前 UI 保持挂载。

### 启动页

启动页只使用原生 DOM 与本地 CSS，因此 bundle 与插件激活失败保持可见：它显示一个 spinner 节点，其 CSS 圆弧随 entry 激活而增长，并逐 entry 报告状态。spinner 及其动画相位会一直保留，直到完整 UI 替换启动页。渲染器交接失败时，启动页会先重新接管挂载点，再报告错误。导入或激活失败的插件会按名称报告并给出原因（缺失服务、导入错误或状态），而不是白屏。

### 共享模块表

Cordis 模块表属于 [`dsh-web-compatibility`](../../../../Compatibility/DSH/web/frontend/README.zh.md)，不属于此 Native 包。Native 浏览器 bundle 使用 Host 编写的模块清单和显式 Native plugin 导出。

### 配置

本包自身不接受任何插件配置；生成的[配置目录](../../../../Docs/config-catalog.zh.md)列出仓库中每个插件配置以供对照。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释启动内核的构建方式；可观察行为已在[使用本包](#use-this-package)中说明。

### 设计理念

本包拥有 Native 浏览器组合 API 与进度页。Host 拥有模块图构建、选择和资源交付；`bootNativeClient` 只导入选中行，并在安装成功后向渲染器提供挂载点。

### 两阶段启动

`bootNativeClient()` 通过 Host 提供的图导入选中的模块，校验其 `plugin` 导出，解析完整 Native 安装，并启动一个需要 `clientApplication` 和 `clientRenderer` 的挂载插件。返回的 host 串行处理替换，并拥有卸载与 Provider 清理。兼容 Loader 及其启动协议位于独立兼容包。

### 启动页机制

启动页是原生 DOM 加本地 CSS，其回退字体与颜色匹配加载期间到达的主题 token。`internal/status` 事件驱动一个 spinner 节点与逐 entry 标签；hydrate 会保留该节点与动画相位直到应用提交，`fail()` 渲染抛出的原因。React 挂载、slot 渲染与应用组装位于 `ui-renderer`；`ui-layout` 拥有组装后的浏览器标题投影。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/native-boot.ts`](src/native-boot.ts) | 原生 Client 行安装、进度报告、渲染器挂载与归属清理 |
| [`src/index.ts`](src/index.ts) | 包根重新导出 Native 浏览器 API |
| [`src/boot-page.ts`](src/boot-page.ts) | Native 与兼容外壳共享的无 Cordis 进度页 |
| [`src/native-wire.ts`](src/native-wire.ts) | Host 注入浏览器数据的无 DOM 类型声明，也由 `./native` 重新导出 |
| [`src/base.css`](src/base.css) | 浏览器基础样式，构建为 `lib/base.css` 并通过 `./base.css` 导出 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当 Native 组合约定不够用时，阅读 Native runtime、渲染器和独立兼容外壳的文档。

- [Native runtime](../../../../Core/native/system/README.zh.md)——Native plugin 解析与生命周期。
- [UI 渲染器](../ui-renderer/README.zh.md)——接收挂载点并把 slot 数据绑定到 React。
- [兼容浏览器 owner](../../../../Compatibility/DSH/web/frontend/README.zh.md)——旧版 Cordis 启动和 worker preview。
- [Client 组图](../README.zh.md)——此包所属的浏览器 Client 部分。

-----

<a id="model-experience"></a>
## 模型体验

无。启动内核属于浏览器侧 UI 插件层，不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明启动内核不支持什么。它们是当前包约束，不是任务积压。

- **应用会等待全部 entry 就绪**——只要一个 entry 失败，无框架启动页就会保留并逐项报告；不支持部分 UI 可用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** Native API 包没有 Cordis 依赖或 Loader entry。Host 提供的图和选中的 Native plugin 行决定组合；`NativeHost` 拥有安装及渲染器清理。此 API 不发布运行时不变式 companion，因为包本身没有可独立变化的注册表状态。
