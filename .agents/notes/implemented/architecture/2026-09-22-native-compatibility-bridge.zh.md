# Agent Note: Native compatibility bridge

Status: implemented

[English](2026-09-22-native-compatibility-bridge.md) | 中文

## Problem

原生 filesystem 和 headless profile 在分阶段迁移期间需要选定的旧 filesystem 实现，但启动旧 bundle 会引入相互竞争的 Agent、工具和 Session 写入者。

## Decision

可选的 `compat-dsh-runtime` 创建一个 Cordis Context，并仅通过 `compatDshRuntime` 服务向选定兼容 bridge 暴露它。bridge 通过 `dsh-plugin-host` 挂载 allowlist 中的插件，由后者持有子 Fiber 和 descriptor 注册。`compat-fs-local` 和 `compat-fs-sandbox` 分别提供 `fs`；sandbox 变体要求选择原生策略。`compat-fs-policy` 将原生 filesystem 事件转发给旧 observation policy，并提供策略权威标记。`compat-tool-fs` 将选定旧工具和提示词 section 注册到原生注册表，而原生 headless 应用校验调用并且只追加一条 Session 结果。

每个 bridge 都会在将所选包挂载为共享 Cordis Context 中的 Loader entry 前校验元数据和配置。Runtime 会在激活前检查精确的 Cordis 4.0.2、Loader 1.0.3 版本，以及受支持的 DSH 包声明。Loader 更新前会排空已接收的原生工具调用和进行中的提示词组装；策略 entry 变更前会排空策略监听器。Bridge 释放时会移除其拥有的原生贡献，Host 关闭时会排空 Context。不含 `compat-dsh-runtime` 的原生安装不会通过此兼容路径加载 Cordis。兼容 profile 通过已发布的 `dsh` 命令运行旧 write 工具，验证 filesystem 变更、模型可见提示词和 schema，以及一条持久结果。[Loader entry 生命周期决策](2026-10-06-native-compatibility-loader-entry-lifecycle.zh.md)记录支持矩阵和 reload 区分。

## Alternatives considered

**加载旧 base bundle。** 它被拒绝，因为其拥有的 Agent loop、Session state 和 tool runtime 与原生权威冲突。

**立即重写选定的旧包。** 它被拒绝，因为分阶段迁移需要在替换阶段前从维护中的 filesystem 实现获得行为证据。

**在策略缺失时让 sandbox bridge 选择本地存储。** 它被拒绝，因为缺少策略必须明确失败，而不是扩大变更访问范围。

## Consequences

原生 profile 可消费选定旧 filesystem 实现，而不产生第二个持久 Session 写入者。兼容层仍限定于已声明包，并保留 Cordis 作为显式依赖。原生策略只有 profile 级 mode，更广的审批、attachment、UI 展示、reload 和 replacement 行为仍由后续迁移阶段负责。
