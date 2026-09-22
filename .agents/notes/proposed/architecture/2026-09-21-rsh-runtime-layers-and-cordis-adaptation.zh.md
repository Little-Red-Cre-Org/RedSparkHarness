# Agent Note: RSH 运行时分层与 Cordis 适配

Status: proposed

[English](2026-09-21-rsh-runtime-layers-and-cordis-adaptation.md) | 中文

## Problem

RSH 物理目录布局标识包所有权，但当前 Cordis 组合仍可能让 Consumer 依赖具体 Provider，或让 Core 包触及产品代码。目录名本身无法区分有效的能力 Definition 依赖和实现泄漏。RSH 还需要原生所有权记录，且不能破坏现有 DSH profile，或把 vendored Cordis runtime 当作可替换的产品插件。

## Proposal

[原生运行时提案](2026-09-22-rsh-native-runtime-and-optional-cordis.zh.md) 替代本提案将 Cordis 作为唯一执行框架的选择。本记录保留适用于旧装配的角色分类、adapter 行为和依赖策略理由。

RSH 有五类运行时所有者：Core 提供基础服务和受控 Cordis framework；Engine 拥有 Agent 执行与持久化 Agent 数据；Modules 提供能力 Definition、Provider、Consumer、policy 和 projection；Compatibility 组合 profile 并适配受支持生态；Programs 承载、传输并呈现已组合的应用。依赖检查将这些所有权规则应用于已声明运行时边，而不是断言单一的目录顺序 DAG。

原生包通过 `dsh.runtime` 声明 API 修订、能力和角色。`dsh-plugin-host` 为活动 Fiber 保留该声明，并适配旧式 Cordis 插件，不包装其服务、事件、Loader 配置或释放。Cordis 仍是唯一插件运行时。Filesystem 是首个能力试点：其 Definition、Provider、Consumer 和 observation policy 获得角色声明，profile 行选择其 adapter 子路径，同时保留现有 `ctx.fs`、工具 schema、Session event 和 patch id。

## Runtime ownership

- Core 永不消费 Engine、Module、Compatibility 或 Program API。
- Engine 永不消费 Compatibility 或 Program API，也不选择 Module Provider。
- Module Consumer 消费公开 Definition 或 registry，绝不消费 Module Provider。
- Compatibility 可以组合公开 Provider 与 Program 面向应用的包，但不拥有 Agent 行为。
- Programs 承载公开组合，不拥有 Agent loop 或具体 Provider 行为。

每项窄范围审阅例外都命名一个遗留 manifest edge，并在该边消失后使验证失败。Community experimental 包在其运行时角色完成设计前保留现有产品集成自由度。

## Alternatives considered

**用 RSH plugin runtime 替换 Cordis：** 拒绝。Cordis 已拥有 Context、Loader、服务、事件和 Fiber cleanup；另一个 runtime 会重复生命周期所有权并破坏 profile。

**将物理目录视为严格依赖 DAG：** 拒绝。能力 Definition、组合 bundle 和面向程序的 client 包有合理的角色特定关系，目录规则无法分类。

**在添加原生 metadata 前重写全部现有插件：** 拒绝。适配优先的迁移保留现有 profile，并让一个能力族先验证该模型，再进行更广泛转换。

## Acceptance criteria

- 运行时 manifest 声明只有一个已文档化 API 修订，并拒绝格式错误的角色或能力。
- constraint check 拒绝 Core/product、Engine/Program、Engine/Provider 和 Consumer/Provider 运行时边，不保留过期审阅例外。
- 通过 adapter 挂载的旧式 Cordis 插件会随所属 Fiber 注册和释放其描述符。
- base profile 在已适配 filesystem policy、Consumer 和 sandbox Provider 行之前挂载 plugin host。
- Filesystem 行为、模型可见内容、Session 格式和 profile patch row id 保持不变。
- 定向角色策略、adapter 生命周期、filesystem 集成、base 组合、Cordis 配置、类型、文档和构建产物检查通过。

## Risks

`dsh.runtime` 声明是公开的 pre-stable metadata，因此在真实 compatibility reader 强制执行前，其词汇必须保持精简。adapter 不沙箱同进程代码；外部插件在独立 compatibility bridge 提供显式 grant 和进程隔离前仍属于可信代码。manifest 检查只能看到已声明 package edge；后续 Host/Client source-import pass 必须解析实际 package owner 后才能强制 import。
