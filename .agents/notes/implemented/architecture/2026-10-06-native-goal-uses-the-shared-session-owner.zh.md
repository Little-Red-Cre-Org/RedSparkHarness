# Agent Note: 原生 Goal 共用 Session owner

Status: implemented

[English](2026-10-06-native-goal-uses-the-shared-session-owner.md) | 中文

## Problem

原生 profile 需要与兼容 profile 相同的持久 Goal 状态和有界续行策略，同时由选定的 Program 独占 Session 持久化与执行权。

## Decision

原生 `@deepseek-ai/dsh-goal` Provider 要求 Program 提供 `agents` 与 `activeSessions` 服务。它从活跃 owner 的持久 Session 事件恢复 Goal 事实，并通过该 owner 追加变更；它不增加 writer 或模型循环。

原生 Goal round driver 使用该 owner 的 admission 与 idle hooks；`@deepseek-ai/dsh-tool-goal` 根据精确的活跃 root Agent 和当前轮次持久用户消息授权变更。新建或恢复的 Goal 初始均为 disarmed；只有显式 human resume 才会启用续行。

已发布的 `native-headless` 与 `native-tui` CLI profile 在 root 安装 Goal Definition、round driver 和模型工具，同时保留唯一一项 `session-execution`。两个 profile 都使用 Program 现有的 Session 与 Agent 权威。

原生 Commands Provider 与 Goal command Consumer 已作为 package 提供，但已发布 CLI profile 未挂载它们，因为 native TUI 尚无命令呈现适配器。原生模型 Goal 工具仍可用；profile 不提供 `/goal` 命令 UI。

## Alternatives considered

- **增加第二套 Goal store 或执行循环。** 拒绝，因为持久 Goal 变更已经属于 Session 日志，平行 owner 会分裂回放、串行化与 turn 权限。
- **在原生 profile 使用兼容版 Goal 入口。** 拒绝，因为原生 profile 加载声明过的 native 入口，并让 Cordis 留在原生依赖图之外。
- **等待原生命令适配器完成后再安装 Goal 工具。** 拒绝，因为模型 Goal 工具提供受支持的人类交互路径，原生 headless profile 也可通过已发布的 `dsh` 入口验证持久续行。

## Consequences

原生 Goal 状态、模型工具与 round admission 共用选定的 Session owner，不会创建额外 writer 或循环。恢复的 active Goal 保持 disarmed，直到人类显式恢复。

原生 headless 用户可通过模型工具创建、续行、阻塞、恢复并完成 Goal。原生 TUI profile 安装相同组件，但不提供 slash command 发现或呈现。

## Verification

构建后的无密钥 `dsh --profile native-headless` 回放使用确定性模型插件替代外部模型，写入 JSONL Session 数据，在一个已准入 Goal Round 后阻塞，重启进程，要求显式 human resume，再完成 Goal。它检查持久 Goal 与消息来源事件、工具 schema、提示词和模型请求。

CLI profile-template 测试检查 `native-headless` 和 `native-tui` 中的 Goal 安装，并确认每个组合保留一项 `session-execution`；该测试不声称覆盖交互式 native TUI 命令流程。
