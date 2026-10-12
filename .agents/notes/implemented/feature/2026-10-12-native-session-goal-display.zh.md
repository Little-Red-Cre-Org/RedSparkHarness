# Agent Note: Native goal display reads durable Session events

Status: implemented

[English](2026-10-12-native-session-goal-display.md) | 中文

## Problem

Native Web 页面需要显示 Session 的当前 goal，同时不新增 Host 操作，也不让 Client 包耦合到 Cordis goal 控件。

## Decision

`ui-goal/native` 对所选 `native-application` controller 的 Session 事件调用 goal 领域的 `foldGoal`。props-only 条带显示目标、持久 phase 和已准入轮次进度，包括已完成的 goal。清除后不再有当前 goal。该视图不读取进程本地 activation，也不执行 goal 操作。持久 goal 模型仍由[同会话 goal 决策](2026-07-16-harness-level-loop.zh.md)拥有。

## Alternatives considered

- **读取 Host goal endpoint。** Controller 已持有所需的持久事件，再读取一次会重复访问 Session authority。
- **复用 Cordis GoalBar。** 它的操作和 activation hook 需要 Native 页面不使用的旧版 Remote 与 renderer。
- **在 Native 中自建 goal fold。** goal 包已定义持久变更与轮次归属的回放规则；第二个 fold 可能与之漂移。

## Consequences

- Native 条带根据所选 Session 历史和实时事件列表更新，不需要 Host API 或第二个 goal store。
- 条带只显示持久目标、phase 和轮次数；activation、变更操作及 `/goal` command input 不属于 Native 视图。
- `native-application` 通过一个基于历史的组件测试固定可见 goal 和已准入轮次计数。
