# Agent Note：Native 精确会话查询入口

Status: implemented

[English](2026-10-09-native-session-query-entry.md) | 中文

## 问题

Native Engine 消费方没有精确会话查询能力。现有 `SessionQueryEngine` 与 `SessionCorpus` 属于 Cordis 服务，但 Native 已有精确读取所需的两个权威：用于已连接可写 owner 的 `activeSessions`，以及用于持久化只读 handle 的 `sessionPersistence`。

## 决策

新增 Cordis-free 的 `@deepseek-ai/dsh-session-query/native` 入口，并通过相同的 `sessionQuery` capability 暴露 `NativeSessionQueryOperations`。Provider 要求 `activeSessions`，并将 `sessionPersistence` 视为可选。它合并持久化 header 与精确活动 owner 的列表，正文读取优先选择当前活动 owner，并在同时观测到两侧时检查不可变 header。

活动正文读取调用精确 owner 的 `readEvents()`。冷读复用 `readColdSessionLog()`；该函数会关闭持久化读取 handle，并且只在内存中补齐中断尾部。两条路径都会在脱离存储的副本上通过 `Session.fromRestore()` 回放校验，并复用共享标题折叠与当前 surface 追踪函数。校验 Session 不会取得 writer 或进入 active-owner registry；查询返回原始读取事件，不包含本地恢复标记。查询不会向 store 注册 Session、创建 writer 或维护第二份缓存。

此 Native 入口只实现 Native 引用所需的精确列表、原始日志、标题与当前表层读取。更广的 Native 查询面仍未完成：观测、会话／事件过滤、事件窗口与精确事件读取、会话／事件追踪、与提供方无关的搜索、SQLite 索引和排序全文搜索都不在此实现中。授权和外部 Host 展示保留各自边界。

Native 跨会话引用通过共享投影与保留逻辑消费此精确查询服务。它们保留新准入消息中的规范 URI 输入，并返回带 source 的上下文消息；`NativeAgentInstructions.prepare()` 将 workspace instructions 排在引用上下文之前，Native headless 再通过既有 Session writer 追加两者。失败或取消时，准备操作会先等待已启动的读取和 spill 写入结束再返回，因此操作完成后 writer 与所选服务可以安全清理。因此，持久化模型输入与 Cordis 的 `@label` 替换有可见差异；此批次不宣称两种表示完全等价。

## 考虑过的替代方案

**直接复用 Cordis `SessionCorpus`。** 它依赖 `Context`、`sessions` 和可选服务注入；导入它会把 Cordis 带入 Native 入口，也无法读取 `activeSessions`。

**维护 Native 查询缓存或 writer。** 第二份缓存或 writer 可能与活动 owner 和持久化历史分歧。按调用读取已能提供此入口公开的精确快照。

## 影响

Native 调用方可以读取脱离运行时的历史，并在不导入 Cordis 的情况下准备持久的不可信引用。没有持久化服务时，查询仍能列出和读取活动 owner，但无法读取已分离会话。冷标题与表层读取会按需载入并校验完整日志，因此大型历史的成本与现有精确读取相同。Native 观测、过滤、事件、追踪和全文搜索仍待迁移。

## 验证

Native query 定向用例覆盖冷持久化列表、标题、日志与表层读取（包含 fork 继承前缀；不挂载 Session，也不修改存储），以及 owner 在读取期间被替换后仍精确处理活动优先级。已编译 Native CLI workflow replay 证明原 URI 消息与带 source 的引用快照都持久化，且模型请求收到捕获的来源文本。目标包类型检查、正常 leaf producer 和所选用例通过；这不代表更广泛的 Native 查询、Host 或 Client 验收。
