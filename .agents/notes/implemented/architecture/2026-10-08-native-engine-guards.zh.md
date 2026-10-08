# Agent Note：原生配置通过注册表与执行策略安装 Cordis 基础 guard

Status: implemented

[English](2026-10-08-native-engine-guards.md) | 中文

## 问题

Cordis 基础组合包会安装三个原生配置所缺少的 guard：按提供方策略的 LLM 重试、声明式工具调用超时以及重复工具提醒。它们各自依赖一个没有原生对应物的 Cordis waterfall（`agent/request-error`、`tools/execute` 或 `tools/post-execute`）。因此，原生轮次会在第一次暂时性提供方错误时失败，声明了预算的原生工具可能超过预算继续等待，模型也可能无限重复同一调用而收不到建议性提醒。

## 决策

每个 guard 包都在保持不变的 Cordis 入口旁新增一个不依赖 Cordis 的 `./native` 安装器。既有逻辑移入运行时无关的 `src/core.ts`：重试决策与等待、截止时间强制执行，以及重复检测器及其配置 schema 与文本。两个入口调用同一份代码；各运行时之间只有插件注册、服务注入与生命周期接线不同。安装器使用既有服务拥有的三个窄接缝，而不是新的事件总线：

- `modelExecution.onRecovery` 提交每个已记录的失败 attempt（包括抛出异常的适配器），并附带该路由解析后的重试策略与调用方的 Session writer 回调。后注册的策略先运行，且至多委派一次，与 Cordis waterfall 一致。`retry` 决定会为同一步骤发起新的 attempt。未声明策略的模型获得 LLM 运行时默认值，与 Cordis 下相同。
- `tools.aroundExecution` 用冻结的工具声明（包括新的 `timeoutMs` 字段）包装每个主体。策略必须恰好委派一次，并可传入替换信号，该信号会与调用方信号合并。
- `tools.onSettlement` 与 `settlementContexts()` 为 Session 拥有者提供每个已记录结果对应的同步用户消息上下文。原生 headless 与 PTC dispatch 对每次结算调用一次，并把这些上下文放在工具自身上下文之前，与 Cordis 放置提醒的位置一致。

全部五个随附原生配置都安装这三个 guard。重复提醒使用基础组合包的 `[3, 5, 8]` 阈值与 500 字符预览。`dsh-tool-fs-search` 声明其 glob 与 grep 预算，并保留内部计时器作为兜底。

## 考虑过的替代方案

共享的原生事件总线会在原生运行时内重新造出 Cordis 分发。在每个模型 Provider 内放置重试包装层，会让每个适配器重复策略与持久事件。在步骤结束后从 Session 事件统计重复，会漏掉嵌套的程序调用，并把提醒放在无关的工具结果之后。从 Session 读取投影的重试历史，需要一个目前尚不存在的原生投影服务。

## 影响

一致性测试让相同场景分别经过 Cordis 与原生路径，比较持久的 `llm/retry` 与 `llm/retry-started` 事件、延迟、`TOOL_TIMEOUT` 结果与提醒消息；一个原生 headless 集成测试通过真实循环驱动全部三个 guard。原生重试历史只在内存中保存当前步骤，因此在重试链中途崩溃后恢复的会话会开始新的预算。替换了最新用户消息的压缩会重置原生重复链。若原生截止时间触发后调用方又取消，注册表会报告该取消。既有的原生配置目录不会被改写；希望在其中启用 guard 的用户可添加这三个安装项或重新创建配置。
