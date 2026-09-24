# Agent Note：原生持久请求时间上下文

状态：已实现

[English](2026-09-23-native-time-context.md) | 中文

## 问题

原生应用需要已有的时钟、经过时长及浏览器时区指引，但不应导入 Cordis Agent pre-step listener，也不能在持久 Session 历史之外修改请求。上下文必须可回放，刷新策略也必须在 Session 恢复后继续有效。

## 决策

`@deepseek-ai/dsh-native-time-context` 提供原生 `timeContext` 服务，源码不直接导入 Cordis。其 `prepare` 方法接收 Session、准确的 turn/step，以及尚未记录的候选用户消息。到期时，它返回一条来源为 `native-time-context` snapshot 的 `user/message`。应用拥有追加顺序，并且必须在派生模型请求前追加返回消息。当前 manifest 与 Session 依赖仍按仓库过渡策略声明 Cordis peer；从已安装生产依赖闭包移除 Cordis 属于 P5。

服务用 Session 拥有者已经加载的事件初始化每个 Session 的时间投影，并在每次事件追加后推进投影；它不会同步读取任意 Session 历史。它只识别开放轮次内、来自经 Host 校验且带规范浏览器时区的 user-RPC 来源。存在唯一时区时，该时区用于显示并向模型提供指引；时区缺失或混杂时，只用配置时区或进程时区格式化时间戳，同时告知模型需要询问用户。第 1 步从最近一条用户消息、助手消息或工具结果开始计算经过时长；后续步骤从当前轮次最新的 time-context 注入开始计算。

只有安装该服务时，`dsh-native-headless` 才会消费它。本包不增加 Session 事件类型、Agent hook、Cordis adapter 或自动 profile 安装。既有 `dsh-time-context` Cordis 插件保持不变。

## 考虑过的替代方案

**适配 Cordis pre-step 插件：** 原生应用仍会依赖 Cordis 生命周期和 Session projection，而这些上下文可以从现有 Session 事件派生。

**在模型分发时插入仅限请求的消息：** 模型可见上下文不会进入 Session 日志，使用该上下文的请求也就无法回放。

**把动态时钟放入系统提示词：** 这会混合请求时事实与稳定应用指令，也让历史中的读数更难归因和调度。

## 结果

原生应用可以添加可回放的时钟上下文，无需改变 Agent 循环或已发布 Session 格式。每个 Consumer 必须追加返回消息，并拥有处理持久化失败的责任。浏览器时区权威仍来自规范的 user-RPC 来源；显示回退值不会变成用户意图。正数刷新间隔可能抑制新轮次的读数，使该请求历史只包含之前的读数。

该决策沿用[上下文 form 词汇决策](../feature/2026-08-05-context-form-vocabulary.zh.md)中的持久上下文来源词汇、[Schedule 时区决策](../simplification/2026-08-09-explicit-schedule-time-zone.zh.md)中的浏览器时区权威规则，以及[请求上下文与 turn 分离决策](2026-07-24-separate-context-injection-from-turn-execution.zh.md)。[Headless 组合决策](2026-09-22-native-headless-profile-composition.zh.md)记录了应用集成。[迁移提案](../../proposed/architecture/2026-09-22-rsh-native-runtime-and-optional-cordis.zh.md)跟踪其余原生迁移。

## 验证

定向测试覆盖持久来源标注、唯一时区的精确格式、混合与缺失时区策略、回退显示、步骤经过时长基线、跨 turn 的 Session 级刷新、无效配置和候选消息。native headless 集成测试验证模型读取请求前已追加该消息。
