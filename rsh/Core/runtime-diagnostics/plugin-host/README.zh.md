---
description: "RSH 插件角色注册表与 Cordis 生命周期适配器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-host

[English](README.md) | 中文

## 概述

`dsh-plugin-host` 记录已挂载包的 RSH 角色和能力域，同时将插件执行、服务、事件、配置和释放保留给 Cordis。`adaptCordisPlugin()` 为 Loader 行包装旧式 Cordis 入口；该包装器要求 `ctx.pluginHost`，保留描述符，在子 Fiber 中挂载原入口，并在包装器 Fiber 卸载时释放描述符。`mountCordisPlugin()` 为集成代码提供等价的直接挂载帮助器。

该包不发布 invariant companion。描述符保留与移除由同一个 Cordis Fiber 生命周期拥有；包测试通过注册表与 disposer 观察这两个事实。

## 目录

- [使用 adapter](#use-the-adapter)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-the-adapter"></a>
## 使用 adapter

在同一个 Loader 配置中挂载 host 与适配后的 runtime 入口。下面的文件系统观察策略通过 `adaptFilesystemPlugin(...)` 发布 `/runtime` 入口；该函数会委托给 `adaptCordisPlugin(...)`。其他包也可以发布专用 runtime 子路径，而不改变普通入口。服务注入会在 `ctx.pluginHost` 可用后激活适配器；仅靠配置项顺序不能建立该依赖。

```yaml
- id: plugin-host
  name: '@deepseek-ai/dsh-plugin-host'
- id: fs-observation-policy
  name: '@deepseek-ai/dsh-fs-observation-policy/runtime'
```

描述符的 `packageName`、`role` 和 `capability` 会在旧插件启动前验证。重复的活动包名会导致挂载失败；模块 HMR（热模块替换）期间，替换适配器会等到正在释放的旧适配器及其子 fiber 完成清理后，才占用该包名。适配插件并不沙箱化它：同进程 Cordis 插件仍是可信代码，并按自己的 `inject` 声明获得 Context 访问权限。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

<a id="model-experience"></a>
## 模型体验

None, as adapter 记录所有权，而 Cordis 保留面向模型的注册。

#### KV Cache 影响

适配器不贡献模型请求内容，因此不影响提供方缓存复用。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **旧式执行保持 Cordis 原生。** 适配器记录 RSH 所有权元数据，但不创建第二套事件总线、Loader、服务容器或安全隔离边界。
- **包元数据是声明性的。** `dsh.runtime` 声明为仓库检查标识 RSH 角色；外部包加载和版本协商仍由未来的兼容桥负责。
