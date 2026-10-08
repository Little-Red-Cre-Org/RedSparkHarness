# Agent Note: 原生压缩

Status: implemented

[English](2026-10-08-native-compaction.md) | 中文

## 问题

上下文压缩、工具结果剪枝器与 `/compact` 此前只以 Cordis 插件形式存在，因此原生 profile 的历史会持续增长，直到提供方拒绝请求。原生 profile 需要相同的阈值、模型生成的摘要、持久化 `compaction/*` 事件与人工命令，同时兼容 profile 保持现有行为。

## 决策

`dsh-compaction` 新增无 Cordis 的 `./native` Definition。它为 `NativeServices.compaction` 增补 `compactIfNeeded(owner, trigger, signal)` 与 `compactNow(owner, signal, sourceCommandId?)`，其中 owner 是 Program 为每个会话提供的 writer 视图（`session`、`writerAvailable`、`append`、`flush()`）。`CompactionTrigger` 与 `ManualCompactionError` 移到两个入口共同导出的与运行时无关的模块，使失败分类与[压缩能力 seam](../feature/2026-06-18-compaction-capability-seam.zh.md) 的事件词汇仍只有单一来源。

`dsh-compaction-basic`、`dsh-compaction-tool-result-pruner` 与 `dsh-command-compact` 成为混合包。它们的区域事务、触发策略、剪枝核心以及命令解析与渲染都成为共享模块，接收显式 `append` 目标而不是 Cordis `Agent`；Cordis 入口委托给这些模块，行为不变。原生压缩提供者先订阅附加与分离事件，再为每个现存 owner 按顺序 `100`（可通过 `admissionOrder` 配置）安装一个 `beforeStep` admission hook；两种方式同时找到同一 owner 时按身份去重。该 hook 在开放轮次内运行共享的压力策略，然后继续 admission，与兼容入口在请求派生之前、Goal 续跑（`700`）之前的 `agent/pre-step` 位置一致。Provider 释放时先排空已接受的生命周期回调，再快照并排空剩余 hook。容量来自已路由模型描述，摘要通过原生 `model.stream()` 发送到配置的摘要器目标或最近一次已路由目标。`compactNow()` 写入 `turn: null` 标记对并 flush owner；Program writer 不可用时以 `busy` 拒绝。

随附的 `native-headless`、`native-web` 与 `native-tui` profile 安装 token meter、剪枝器与压缩；`native-tui` 另外挂载 `/compact`。`native-sdk` 与 `native-acp` 保持最小组合。

## 备选方案

**直接移植 Cordis listener 模型：** 拒绝，因为原生 profile 没有 `agent/pre-step` 事件；Program 的 admission waterfall 才是在开放轮次内、请求派生之前运行的原生位置。

**在原生入口中复制事务：** 拒绝，因为标记对、保留与缩减验证定义了持久化日志语义；两份副本会逐渐偏离，并对同一历史产生不同日志。

**现在就加入原生上下文溢出恢复：** 暂缓，因为原生执行器未暴露请求错误 hook，且重试策略属于另一项原生 LLM 防护工作。`compactIfNeeded(owner, 'context-overflow', signal)` 仍可供该集成使用。

## 后果

原生与兼容 profile 持久化完全相同的 `compaction/*` 标记对与检查点消息，CLI 现在直接依赖压缩包而不再将其视为可选。原生 profile 不会在压缩后重试提供方的溢出响应。在任何请求被路由之前没有摘要器目标，因此不会压缩。原生 `compactRegion()` 与运行时不变式伴生入口仍只用于兼容入口，原生 Web 也没有可执行 `/compact` 的命令界面。本 note 扩展而非取代[调用后压力与溢出恢复](2026-07-10-after-call-compaction-pressure-and-overflow-recovery.zh.md)与[排队的手动压缩](../feature/2026-07-30-queued-manual-compaction.zh.md)决策。
