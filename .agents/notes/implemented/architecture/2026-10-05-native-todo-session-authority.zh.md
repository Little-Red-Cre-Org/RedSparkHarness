# Agent Note: 原生任务清单使用选定的 Session 权威

Status: implemented

English | [中文](2026-10-05-native-todo-session-authority.md)

## Problem

应用选择原生工具注册表时，任务清单更新仍需持久化且具备明确归属。加载 Cordis 投影注册表会使这个消费者依赖兼容运行时。

## Decision

原生任务清单消费者通过选定的原生 Tools 注册，并通过已准入调用的持久化回调写入 `todo/write`。它要求精确的活动 Agent 与 Session 所有者，并拒绝在开放 turn 之外写入。共享规范化与模型指令使两个入口的并行策略及清单约束相同。原生读取操作等待当前写入权威的历史读取，并折叠整表替换与 turn 开始事件；它不拥有第二份任务清单存储。

## Alternatives considered

独立可变的原生清单会形成另一个状态权威，并要求恢复及 fork 时同步。向原生消费者导入 Cordis 投影服务会保留兼容依赖。同步扫描 Session 历史会违反异步历史读取策略。

## Consequences

原生入口要求 `tools` 与 `activeSessions`。显式原生模板安装 Session 执行 Provider，使工具准入与持久化写入共享它选定的所有者。返回计数发生在持久化之后；注册离开时，原生注册表取消并等待已准入调用结束。兼容 profile 仍可使用旧入口及其 UI 投影。这个决定不切换产品默认装配，也不迁移原生 Client 的任务清单 UI。
