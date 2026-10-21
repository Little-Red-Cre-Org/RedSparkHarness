# Agent Note：Session 模型选择与 prepared 派发

Status: implemented

[English](2026-10-05-native-model-selection-and-prepared-dispatch.md) | 中文

## 问题

Session 需要在冷恢复后保留模型选择。目录元数据与实际请求默认值可能不同；若记录一个路由却派发另一代配置，模型输入就无法重建。

## 决策

模型目录定义属于 NativeModelExecution。Pi 与 Direct Provider 基于实际配置路由，发布共享的适配器实现。目录提供候选选项，不拥有全局默认值，也不决定路由可用性。

NativeModelSelection 仅通过 Program 准确的活跃 root owner 保存完整意图。选择串行比较 revision，并在确认前 flush 事件。Headless 为每个已接纳 root step 捕获意图，模型执行器再一起捕获元数据与派发。Program 在派发前持久化 prepared 参数及路由变更提示。委派执行保留显式配置。

浏览器安全的选择叶子拥有事件声明与投影。兼容 Session API 重导出同一类型。不引入第二个 writer、模型配置存储或协议载体。

## 备选方案

使用目录建议默认值派发，可能将一次查询的元数据与另一代请求混合。把选择放在应用缓存中会丢失冷恢复与 fork 历史。因此拒绝这两种方案。

## 影响

模型变化会增加已持久化的模型可见提示；仅 reasoning 变化时记录新的请求参数，不添加路由提示。解析失败与过期 revision 不追加选择事实。移除会阻止新工作并排空已接纳的模型与目录操作。现有适配器迭代器清理继续负责暂停的流。

SDK 与 ACP 传输仍是独立消费者。本批提供完整的目录、选择与 Headless 执行链，不修改默认 profile、设置、辅助模型请求或 retry policy。
