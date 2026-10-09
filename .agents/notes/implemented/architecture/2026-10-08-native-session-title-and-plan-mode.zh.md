# Agent Note：基于共享核心的原生会话标题与计划模式

状态：已实现

[English](2026-10-08-native-session-title-and-plan-mode.md) | 中文

## 问题

[兼容性清单](2026-10-01-cordis-compatibility-inventory.zh.md)把 `dsh-session-title`、其 LLM 提供方与 `dsh-plan-mode` 列为没有原生入口的 Cordis 基础 bundle 功能，因此原生 profile 没有会话标题、`/plan` 命令和 `exit_plan_mode` 评审。标题服务与计划控制器把行为写在 Cordis `Service` 类内部，原生入口若直接实现，就必须重写调度、取代、回退、选择与评审规则。

## 决策

迁移框架，而不是重写行为。每个包保留一份框架无关的核心与两个薄入口：

- **会话标题。** `src/engine.ts`（`SessionTitleEngine`）负责提供方注册与拆卸、按会话的修订与取代、首消息与全消息调度节奏、按路由门控的自动生成、确定性回退、重命名、刷新与结果接受。`src/facts.ts` 负责 `session/title` 事件、提供方 id、消息提取、校验、日志折叠与配置校验。Cordis 服务以投影、`session/event` 与带标记的 `llm/stream` 请求适配 `Session`；原生 `./native` 入口适配已附着的 owner，折叠其日志，转发 `user/message`、`request/header` 与 `step/end`，经 owner 持久化，并在提供方运行期间保持 owner 驻留。
- **标题生成。** `dsh-session-title-llm/src/core.ts` 负责配置校验、路由解析、封装、`session/title-llm-request` 记录、分发、输出校验与消息选择器。Cordis 辅助函数经 `ctx.llm` 流式请求；`nativeSessionTitleLlmPlugin` 经原生 `model` 服务流式请求。两个提供方包的两个入口都使用共享选择器。
- **计划模式。** `src/selection.ts` 负责选择状态机（`committed`、`queued`、`cancelled`、`noop`）、步骤边界应用、通知规则、`/plan` 解析与经评审的退出；`src/common.ts` 负责事件、配置、文本与评审问题。Cordis 控制器保留 pre-step 监听、提示词段落与投影。原生入口在下一个被接受的步骤应用待定选择，并以排队的计划模式通知送达指导（原生系统提示词不可变）。步骤准入只发生在内存中，因此需要通知的选择在其通知的 `user/message` 持久化时才提交，而不是在准入钩子中提交；准入后被撤回的通知会在 turn 结束时重新排队。上一个 `step/start` 时的模式，或某条已持久化通知所告知的模式，即为已告知模型的模式。

`native-tui` 以 Cordis 基础 bundle 的配置安装计划模式、会话标题与首消息提供方；`native-web` 安装会话标题与首消息提供方。

## 考虑过的替代方案

**仅为原生重新实现：** 会重复标题并发规则与计划选择规则，两个运行时会逐渐分叉。

**由准入钩子添加计划通知：** 原生步骤准入只能选择已捕获的 inbox 候选，因此通知在选择发生时排入持久 inbox，若在准入前撤销选择则撤回该通知。

## 结果

Cordis 行为与测试不变；两个运行时执行相同的标题与计划决策。原生差异仅限于投递方式：计划指导是历史中的通知而非提示词段落；空闲时的 `/plan <消息>` 等待下一条提示，而不是唤醒一个 TUI 不显示的 turn；标题提供方调用只有在比主请求更久时才会延长 turn。原生 Web 计划模式、`native-headless`、`native-sdk` 与 `native-acp` 中的标题界面以及原生标题命令仍为延期工作。

在兼容性清单中，`dsh-plan-mode`、`dsh-session-title-llm`、`dsh-session-title-first-prompt-llm` 与 `dsh-session-title-all-prompts-llm` 从 `migration-required` 变为 `native-mixed`（154 → 150，75 → 79），`dsh-session-title` 仍为 `native-mixed` 并新增 `./native` 入口。直接 Cordis 使用数保持 1,783，因为 Cordis 入口作为同一核心之上的胶水层保留。

## 验证

使用模拟模型的原生测试覆盖空闲与 turn 中的 `/plan` 选择、通知撤回、准入后被拒绝的通知（选择保持待定，只在后续步骤持久化该通知时提交）、批准／继续规划／关闭评审／非计划模式退出路径、回退标题、使用已记录路由的提供方标题、`session/title-llm-request` 记录、重命名固定与刷新。五个包及其依赖方的既有 Cordis 测试保持不变地通过，CLI profile 测试检查内置行。
