# Agent Note: Native compatibility bridge

Status: implemented

[English](2026-09-22-native-compatibility-bridge.md) | 中文

## Problem

原生 filesystem 和 headless profile 在分阶段迁移期间需要选定的旧 filesystem 实现，但启动旧 bundle 会引入相互竞争的 Agent、工具和 Session 写入者。

## Decision

可选的 `compat-dsh-runtime` 创建一个 Cordis Context，并仅通过 `compatDshRuntime` 服务向选定兼容 bridge 暴露它。bridge 通过 `dsh-plugin-host` 挂载 allowlist 中的插件，由后者持有子 Fiber 和 descriptor 注册。`compat-fs-local` 和 `compat-fs-sandbox` 分别提供 `fs`；sandbox 变体要求选择原生策略。`compat-fs-policy` 将原生 filesystem 事件转发给旧 observation policy，并提供策略权威标记。`compat-tool-fs` 将选定旧工具和提示词 section 注册到原生注册表，而原生 headless 应用校验调用并且只追加一条 Session 结果。

每个 bridge 都会在挂载插件前读取并校验所选包元数据和配置。兼容运行时要求 Cordis 主版本 4，并拒绝 allowlist 以外的插件名。重复 Provider 和策略权威会在解析原生安装时失败。bridge 释放会等待已接收的旧工具执行、移除所属原生贡献并等待子 Fiber 结束；Host 关闭时再排空共享 Context。不含 `compat-dsh-runtime` 的原生安装不会通过此兼容路径加载 Cordis。兼容 profile 通过已发布的 `dsh` 命令运行旧 write 工具，验证 filesystem 变更、模型可见提示词和 schema，以及一条持久结果。

## Alternatives considered

**加载旧 base bundle。** 它被拒绝，因为其拥有的 Agent loop、Session state 和 tool runtime 与原生权威冲突。

**立即重写选定的旧包。** 它被拒绝，因为分阶段迁移需要在替换阶段前从维护中的 filesystem 实现获得行为证据。

**在策略缺失时让 sandbox bridge 选择本地存储。** 它被拒绝，因为缺少策略必须明确失败，而不是扩大变更访问范围。

## Consequences

原生 profile 可消费选定旧 filesystem 实现，而不产生第二个持久 Session 写入者。兼容层仍限定于已声明包，并保留 Cordis 作为显式依赖。原生策略只有 profile 级 mode，更广的审批、attachment、UI 展示、reload 和 replacement 行为仍由后续迁移阶段负责。
