---
description: "可移植的原生插件计划、作用域服务和所属异步清理。"
kind: "package-library"
---

# @deepseek-ai/dsh-native-runtime

[English](README.md) | 中文

## 概述

这个库解析显式选择的插件，并在不使用 Cordis 或 Node 导入的情况下激活它们。它只依赖可移植的 `dsh-brand` 类型辅助包。原生执行 API 修订版 1 独立于 `dsh.runtime` 角色元数据和 Session 版本。

## 目录

- [安装与清理](#installation-and-cleanup)
- [入口元数据](#entry-metadata)
- [事件](#events)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="installation-and-cleanup"></a>
## 安装与清理

`NativeContributions<T>` 在一个 Provider 作用域树内保存具名值。查找包含祖先，为每个名称选择最近的注册，并排除兄弟作用域；树外注册和查找均失败。同一层内的重复名称会失败。注册返回绑定于该次注册的幂等 disposer，即使后继所有者注册同一个值也不会被误删。Consumer 负责资源清理，并在向调用方暴露可变值前复制它们。

`resolveInstallation(requests, target)` 在解析配置前检查版本、目标、Provider 冲突、缺失依赖和依赖环。插件的 `resolve(config)` 验证配置而不获取资源，并返回激活函数。Consumer 仅读取已声明的服务，选择自身作用域或祖先中最近的 Provider；独立根隔离 realm。只有激活成功且声明的全部服务存在后，Provider 才可见。

Service Definition 包在 `@deepseek-ai/dsh-native-runtime` 包根入口扩展 `NativeServices`，事件 Definition 包扩展 `NativeEvents`。Host 和事件总线使用相同的合并后声明。

`NativeHost` 在调用每次激活前建立所有权。插件通过 `context.own()` 立即登记资源清理，通过 `context.effect()` 登记贡献，通过 `context.on()` 订阅。effect 的 disposer 必须同步关闭接收，并返回已接收回调全部结束后的完成信号。所有者取消时，全部 effect 先开始排空，再释放任何资源，包括注册后才获取的资源。停止时中止所属信号、关闭事件接收、等待回调和启动结束，并先释放 Consumer、再释放 Provider。资源清理按获取顺序的逆序执行，尝试所有 disposer，并报告聚合失败。插件必须配合取消，并在释放期间等待自身在途工作。清理不会撤销已完成的外部写入。

`context.optional()` 仅读取显式可选的能力，在未选择 Provider 时返回 undefined。`host.remove(request)` 接收原始安装请求对象，停止该安装及其传递消费者。无关所有者保持活动；受影响的订阅停止接收事件，并在资源释放前等待回调结束。移除是幂等操作，不会自动选择其他 Provider。

`host.diagnostics()` 报告各次安装生命周期的不透明标识、不透明作用域标识、选定服务 Provider、生命周期状态、失败阶段及清理结果，包括已释放的前继实例，不包含配置值、作用域对象和错误消息。`host.run(scope, initiator, work)` 为每次调用显式捕获发起执行；并行调用保留各自的 actor，停止时等待已接收工作结束，再释放 Provider。`host.runOwned(request, initiator, work)` 另外将取消绑定到已就绪安装；移除或替换其所有者时，会取消并等待该操作结束。`host.signal` 表示整个 Host 的取消；单独替换安装不会中止它。

`host.replace(plan)` 接收同一 Host/Client 目标的完整已解析计划。仅当所选依赖也未变化时，复用请求才会保留其已就绪所有者。依赖变化会重新激活传递 Consumer，包括可选或更近作用域的 Provider 变化。排队中的变更拒绝新的 Host 调用；受影响的调用和订阅先排空，再按依赖逆序清理，且清理完成后才激活后继实例。任何实际变更都会保守地取消未绑定所有者的 `run()` 调用；无关的 `runOwned()` 调用保留原生命周期。解析失败保留旧组合；清理或激活失败会停止 Host 并释放全部剩余所有者，不恢复已释放的服务。

公开的 `ResourceOwner` 持有嵌套执行期间取得的资源。其可等待释放按获取顺序的逆序清理每项贡献，并在全部释放结束后报告清理失败。调用方先完成已接纳工作，再释放其资源。

`context.groupInstallations()` 将安装所在作用域及其后代组成共同移除和替换的安装组。成员请求或所选依赖变化时，所有成员一起重启，即使其他成员的请求未变。无关作用域保留其所有者。任何受影响资源释放之前，全部受影响所有者的注册先完成排空；`ResourceOwner.drainRegistrations()` 提供该取消屏障，但不释放资源。安装组注册归所属安装持有，并支持幂等的提前解除。

<a id="entry-metadata"></a>
## 入口元数据

`parseNativeEntryManifest(value, exports)` 在导入入口前校验 `package.json.dsh.native`。修订版 1 声明已导出的包子路径、Host/Client 目标和必需、可选、提供的服务名称。`validateNativePluginEntry(plugin, manifest)` 随后在规划前核对具名 `plugin` 导出与元数据是否一致。[CLI 原生加载器](../../../Programs/CLI/README.zh.md#profiles)使用这两项检查；本库不读取包文件，也不启动应用。应用 Provider 提供 `NativeApplication.run(args, signal)`；CLI 经 `host.runOwned()` 调用，并等待 Host 完成资源释放。

<a id="events"></a>
## 事件

事件 Definition 包从包根入口扩展 `NativeEvents`，并声明模式、参数和结果。同步分发传播异常；串行投递在拒绝时停止；并行投递在所有监听器结束后报告失败。Waterfall 要求显式调用 `next()` 委托，支持短路并拒绝重复委托。祖先订阅按注册顺序接收后代分发；其他 realm 不接收。异常隔离由事件所有者负责。

<a id="model-experience"></a>
## 模型体验

无，因为该库不构造模型请求或持久化 Session 事件。

#### KV Cache 影响

不增加或重排请求内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 本库不提供 profile 文件自动监视和模块代码重载。通用诊断包含生命周期阶段，但不包含应用故障细节。调用方必须在被排空的工作或回调之外等待 `stop()`、`remove()` 和 `replace()`；等待自己的完成会造成死锁。Engine 传入真实的 Agent/工具发起者，并负责 Session 刷新顺序。同进程插件是受信任代码；作用域可见性不会隔离 Node 访问。

不发布 invariant companion：安装就绪和资源释放只有一个所有者，没有需要核对的独立持久化观测。

<a id="dev-note"></a>
### 开发备注

无。
