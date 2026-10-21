# Agent Note: 无框架依赖的原生安装基础

Status: implemented

[English](2026-09-22-native-runtime-foundation.md) | 中文

## Problem

当前插件安装与服务可见性由 Cordis Fiber 管理。只要每个包都必须依赖这一所有者，原生产品就无法接入已有的 Agent、工具和 Session 能力。[原生运行时迁移提案](../../proposed/architecture/2026-09-22-rsh-native-runtime-and-optional-cordis.zh.md) 规定完整产品路线；本文记录现在已有的基础实现。

## Decision

`rsh/Core/runtime-diagnostics/native-runtime` 下的 `@deepseek-ai/dsh-native-runtime` 提供独立安装计划、作用域服务、四种事件模式、自有注册和可等待释放。`resolveInstallation` 在激活前拒绝不支持的目标、依赖问题和 Provider 冲突。配置解析返回激活工作，不获取资源。Host 仅在激活成功后发布全部承诺服务；失败时回滚注册和资源。

Host 记录不含配置值的诊断，包括不透明安装和作用域标识、选定 Provider 标识、生命周期状态、失败阶段和清理结果。`run(scope, initiator, work)` 向每次异步操作显式传入发起 actor，停止时排空已接收工作。运行时不从插件安装作用域推断 actor。`parseNativeEntryManifest` 在加载代码前检查新的 `dsh.native` JSON 声明和已导出子路径；`validateNativePluginEntry` 在规划前核对导入入口的声明。现有 `dsh.runtime` 仍是角色元数据。

`@deepseek-ai/dsh-brand` 与新增的 `@deepseek-ai/dsh-errors` 是可移植的 Core 工具。模型错误模块为现有消费者重导出同一个错误身份；`dsh-llm` 将 `dsh-errors` 列为 peer，使 `instanceof HarnessError` 使用同一个构造函数。`verify-native-dependencies` 门禁从两个 TypeScript 编译面检查明确列入名单的全部原生源码所有者，拒绝外部源码和 manifest 依赖、计算式加载与无效原生元数据。原生包策略现在区分严格无 Cordis 包与混合包：严格包不声明 Cordis；混合包可以为旧根入口保留可选 Cordis peer，但必须保证已声明的原生导出闭包不依赖 Cordis。

包根入口声明可扩展的 `NativeServices` 和 `NativeEvents` 接口。Provider Definition 包扩展该根入口，Host 和事件总线也从同一处导入声明，因此它们的服务键和事件键包含这些扩展。

## Alternatives considered

**在重命名的接口后继续使用 Fiber：** 原生包仍会在类型或运行时加载时依赖 Cordis，无法满足独立分发目标。

**从安装或事件注册推断发起者：** 并行 Agent/工具调用可能误用彼此的 Session 权威。因此 actor 保持为每次操作显式传入的值。

**全局取消 Cordis peer 要求：** 这会掩盖旧包意外缺失 peer 的问题。例外仅针对精确的原生包名单，并有拒绝反例。

## Consequences

运行时库可以在不依赖 Cordis 的情况下构建和使用，两个编译面都会检查其源码和 manifest 依赖。当前 `dsh` profile 仍采用旧装配。原生产品行为成立之前，Engine 还必须传入真实 Agent/工具 actor、负责 Session 刷新顺序，并将原生运行时接入真实 profile。操作本身属于排空范围时，不能在该操作内等待 `stop()` 或 `remove()`；编排层从受影响工作之外调用并等待释放。静态 manifest 校验不加载包；后续 profile 加载器负责这项 I/O 和导入前校验。
