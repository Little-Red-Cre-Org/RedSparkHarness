# Agent Note：原生 Worker 线程代码运行时

状态：已实现

[English](2026-09-23-native-code-runtime.md) | 中文

## 问题

原生 profile 已能拥有 Agent、工具审批和 job，却不能在不导入 Cordis code-runtime service、Context 生命周期、校验依赖或其 profile 装配的情况下执行模型编写的 TypeScript。现有 worker-thread 实现已经有经过测试的资源隔离措施和 JSON 端口行为，程序作者应继续获得兼容体验。

## 决策

`@deepseek-ai/dsh-code-runtime-definition` 拥有可移植的 `CodeRunRequest`/结果词汇与 `CodeRuntimeDefinition`；`NativeCodeRunRequest` 增加原生专用停止回调，用于取消调用方拥有的 binding。`@deepseek-ai/dsh-native-code-runtime` 是为 `codeRuntime` 提供服务的无框架 Host Provider。Provider 保留 worker 执行行为，在激活前 resolve 四项显式资源限制，经由 `NativeContext.own()` 拥有 `dispose()`，并在 Host 关闭时终止所有存活 worker。其源码位于 `rsh/Modules/Official/code-runtime/native-code-runtime`；Cordis `dsh-code-runtime` adapter 仍位于 `rsh/Compatibility/DSH/bridge/compat-code-runtime`，并实现不含原生专用回调的共享 Definition。

本包不导入 Cordis runtime 或 adapter。`dsh-native-headless` 将可选服务消费为固定 `run_code` 操作，不提供宿主 binding，并在下一次模型请求前把有界 JSON 结果作为普通工具结果写入。其他原生应用必须提供自己的 binding，并决定自己的 Session 投影。Cordis worker-thread 包保持不变，因此既有 Cordis profile 会继续使用当前 seam 实现，直到后续 profile 默认迁移。

## 考虑过的替代方案

**包装 Cordis worker-thread service：** 这会让原生 profile 执行依赖第二套生命周期和框架 scope，同时仍让 Provider 清理跨两个运行时分散。

**就地切换现有包：** 这会在其 consumer 尚未迁移前改变已发布 Cordis profile 的公共行为和依赖图。

**推迟所有代码执行：** 原生应用就不能在其余运行时迁移继续时采用已有的程序和 binding 词汇。

## 结果

原生 profile 现在拥有 worker-thread 代码 Provider，具有与既有实现相同的可移植源码约束、结果分类、空环境、资源上限和强制 worker 终止行为。它是隔离措施而非 sandbox，也不会停止子 OS 进程。P5 必须决定已完成的原生 consumer 是否让该 Provider 成为 profile 默认值；本 P4 变更有意保持默认值不变。

## 验证

原生 Host 测试验证 manifest 接线、空配置默认值、配置拒绝、真实 worker binding 往返、输出顺序、abort 报告、Host 清理，以及释放后的拒绝。原生 headless 集成测试运行 `run_code`，证明 schema 对模型可见，并验证其有序的 Session 工具结果投影。
