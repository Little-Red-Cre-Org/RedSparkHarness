# Agent Note：原生 Worker 线程代码运行时

状态：已实现

[English](2026-09-23-native-code-runtime.md) | 中文

## 问题

原生 profile 已能拥有 Agent、工具审批和 job，却不能在不导入 Cordis code-runtime service、Context 生命周期、校验依赖或其 profile 装配的情况下执行模型编写的 TypeScript。现有 worker-thread 实现已经有经过测试的资源隔离措施和 JSON 端口行为，程序作者应继续获得兼容体验。

## 决策

`@deepseek-ai/dsh-code-runtime-definition` 拥有可移植的 `CodeRunRequest`/结果词汇与 `CodeRuntimeDefinition`；`NativeCodeRunRequest` 携带当前准确 Native Session，作为宿主内策略上下文，并增加原生专用停止回调，用于取消调用方拥有的 binding。`@deepseek-ai/dsh-native-code-runtime` 是提供 `codeRuntime` 的无框架 Host worker Provider；它不会序列化 Session 或执行其文件策略。`@deepseek-ai/dsh-code-runtime-process-sandbox` 是受限 Host Provider：它通过 `NativeSandboxPolicy.resolve({ session })` 解析有效模式与工作区，并把同一策略交给进程约束，同时以其根目录作为子进程 `cwd`。它支持受约束的 `read-only` 与 `workspace-write` Session，并拒绝有效模式为 `danger-full-access` 的 Session；该模式需要另行选择明确允许未受限执行的 Provider。Cordis `dsh-code-runtime` adapter 仍位于 `rsh/Compatibility/DSH/bridge/compat-code-runtime`，实现不含原生 Session 或停止回调的共享 Definition。

本包不导入 Cordis runtime 或 adapter。`dsh-native-headless` 在每次固定 `run_code` 操作中把当前 Session 传给所选 Provider，不提供宿主 binding，并在下一次模型请求前把有界 JSON 结果作为普通工具结果写入。Session 策略受限时，其 builtin 与 PTC Consumer 会拒绝未受限 worker Provider；进程 Provider 会应用该 Session 策略。其他原生应用必须提供自己的 binding，并决定自己的 Session 投影。Cordis worker-thread 包保持不变，因此既有 Cordis profile 会继续使用当前 seam 实现，直到后续 profile 默认迁移。

## 考虑过的替代方案

**包装 Cordis worker-thread service：** 这会让原生 profile 执行依赖第二套生命周期和框架 scope，同时仍让 Provider 清理跨两个运行时分散。

**就地切换现有包：** 这会在其 consumer 尚未迁移前改变已发布 Cordis profile 的公共行为和依赖图。

**推迟所有代码执行：** 原生应用就不能在其余运行时迁移继续时采用已有的程序和 binding 词汇。

## 结果

原生 profile 现在拥有 worker-thread 代码 Provider，具有与既有实现相同的可移植源码约束、结果分类、空环境、资源上限和强制 worker 终止行为。它是隔离措施而非 sandbox，也不会停止子 OS 进程。受限组合必须选择消费当前 Session 策略的进程 Provider；worker Provider 不能兑现该约束。P5 必须决定已完成的原生 consumer 是否让某个 Provider 成为 profile 默认值；本 P4 变更有意保持默认值不变。

## 验证

原生 Host 测试验证 manifest 接线、空配置默认值、配置拒绝、真实 worker binding 往返、输出顺序、abort 报告、Host 清理，以及释放后的拒绝。原生 headless 集成测试证明 builtin 与 PTC Consumer 会传递当前 Session、在 worker Provider 下拒绝受限 Session 策略，并保留有序 Session 工具结果投影。参数化进程 Provider 测试验证 Session 的 `read-only` 和 `workspace-write` 覆盖及工作区根目录均传到 `ProcessSandbox.confine()` 与子进程 `cwd`，并在 confinement 或 spawn 前拒绝 `danger-full-access`；这些 seam 测试不声称验证操作系统逃逸边界。
