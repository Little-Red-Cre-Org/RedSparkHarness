# Agent Note: 原生 Agent 标识与 initiator 注册表

Status: implemented

[English](2026-09-23-native-agent-initiator.md) | 中文

## Problem

原生 headless 应用能运行真实 turn，但没有存活 Agent 标识、每 Agent 作用域或异步 initiator owner。工具贡献可以收到 Session，而后台工作仍没有不依赖框架的方式识别启动它的 Agent。

## Decision

`@deepseek-ai/dsh-native-agent` 为原生 Host profile 提供 `agents`。`NativeAgentRegistry` 在显式子 `NativeScope` 中记录不透明且非空的 Agent 标识，触发成对的 Host-local `agent/created` 与 `agent/disposed` 生命周期边，并在创建通知失败时移除条目。每次注册返回捕获该条目的幂等 disposer，因此陈旧 disposer 不能移除之后使用相同 id 的 Agent。

注册表只在 Host 包中使用 `AsyncLocalStorage`，以便在返回的 Promise 工作中保留显式 Agent。`withInitiator()` 与 `withoutInitiator()` 保留精确返回值，在释放开始后拒绝新 boundary，并在 initiator 读取失效前排空活动 boundary。`onDispose()` 只在精确 Agent 仍可用时接受资源清理项；随后 Agent 释放会使标识不可用、排空这些回调并触发 `agent/disposed`。注册表将 initiator 归属、作用域可见性、安装所有权、Session 所有权和授权视为不同关系。

原生 headless 现在要求 `agents`。它从每个 Session 标识创建一个子作用域 Agent，在该 Agent boundary 内运行模型和工具活动，并在 turn 结束后注销。原生工具贡献会连同 Session 和取消信号收到相同 Agent。旧 filesystem 工具适配仍限制在其支持的 Session 视图中，不创建旧 Agent 注册表或 Session 写入者。

## Alternatives considered

**在原生 headless 中使用 Cordis AgentRegistry：** 这会让原生 profile 构造 Cordis 服务树，并引入第二个运行时权威。

**从安装作用域或 Session 对象推断 initiator：** 一个应用安装可以并发执行多个 turn，这两个值都可能把别的 turn 标识分配给后台工作。

**把 Agent 标识保留在 headless 内部：** 工具、审批策略、任务和子 Agent 都需要同一个显式标识，而不应导入应用实现。

## Consequences

原生 profile 行会在原生 headless 前安装 `@deepseek-ai/dsh-native-agent`。它的仅 Host 原生入口不导入 Cordis，manifest 也不声明 Cordis peer。注册表不替代旧 Agent loop、持久化 Session、工具授权、workflow 或 Client projection；这些能力继续沿各自显式迁移路径推进。

## Verification

原生 Agent 测试覆盖作用域成对生命周期事件、冲突拒绝、创建监听器回滚、并发 initiator 隔离、清空 boundary、initiator 释放排空，以及生命周期事件触发前的 Agent 所有清理。原生 headless 和兼容组合安装同一个 Provider，并将精确的已注册 Agent 传给原生工具贡献。
