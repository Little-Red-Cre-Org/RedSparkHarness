# Agent Note: 原生 ACP 展示与列表

Status: implemented

[English](2026-10-14-native-acp-presentation-and-listing.md) | 中文

## 问题

原生 ACP 已接受图片提示和持久化 Session 事实，但输出投影与 Session 列表仍落后于兼容 ACP 承载层。

## 决策

原生 ACP 通过现有附件 Provider，将已提交的助手与工具结果图片引用投影为 ACP inline image content。异步读取和通知仍进入提示执行的有序通知队列；读取完整性和传输失败会反馈给提示响应，关闭操作会等待已接收的提示工作排空。

仅当助手事件记录了 provider usage、精确 Session 请求上下文包含 context-window 容量，并且安装了可选 token meter 时，原生 ACP 才报告 `usage_update`。实时事件使用其 Engine 所有的活动 Session。恢复展示会通过只读 `Session.fromRestore` 路径，结合存储的 header 和继承事件数，按事件前缀计量；此路径不创建 Session writer，也不选择替代模型路由。

`sessionListPageSize` 是正安全整数配置项，默认 `100`。原生 ACP 使用兼容承载层的规范 base64url 游标，按 `createdAt` 降序、UTF-8 Session id 升序排列，因此相同时间戳也有确定的续页顺序。

此项补齐不宣称完整 ACP 对等能力。音频和嵌入资源输入、ACP question 请求（向人请求补充输入）、MCP resources 或 prompts 以及 shutdown 仍不支持；资源链接输入和 machine permission request 保持现有行为。

## 考虑过的替代方案

**另建 Session writer，或通过当前 parent model 计量 usage。**不采用，因为 Engine 所有的 Session 和已记录的请求路由分别是持久事实与容量信息的唯一权威。

**补齐缺失的输出投影后声明支持所有 ACP 通道。**不采用，因为音频、嵌入资源输入和 human elicitation 仍不属于已确认的兼容能力范围。

## 影响

ACP 客户端可以在不重复拥有 Agent、Session 或存储的前提下接收图片输出、有依据时的路由 token 占用，以及可恢复的分页结果。已存图片损坏会使已接收的提示失败，而不会静默丢弃输出。
