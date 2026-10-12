# Agent Note: Native 会话详情使用已观察事实

Status: implemented

[English](2026-10-12-native-session-details.md) | 中文

## Problem

Native 右侧面板此前只显示所选 Session id 与工作目录，而对应的 legacy Cordis 面板包含文件浏览和文档预览的 tab 停靠面。Native Session history 与 roster API 提供对话事实，但不能枚举或读取工作区文件；Native 面板不得暗示自身具备并不存在的访问能力。

## Decision

`ui-sidebar-right` 的 Native 入口通过现有 Client 数据呈现“概览”和“活动”分区。概览读取当前 Session header 与 roster 项。面板显示时，活动页调用 `NativeSessionClient.history()` 并统计 durable 轮次、用户与助手消息、工具调用和已记录 token 用量；它也从 history events 显示最近一次请求路由与上下文窗口。已执行模型事实以请求日志为准；advisory 模型目录不能替代它。

该面板与 legacy 文件树及文档预览共用 `SidebarPathBar`。由于 Native 组合没有 Session 作用域的工作区文件客户端，面板省略文件列表和文档内容；轨迹检查不属于本面板。Cordis 停靠面与资源所有权仍由[右侧 Sidebar 停靠基础设施](2026-09-04-right-sidebar-docking-infrastructure.zh.md)定义；Native 左侧 Sidebar 投影仍由[Native sidebar Session 投影](2026-10-11-native-sidebar-session-projection.zh.md)定义。

## Alternatives considered

- **在本次变更中增加工作区文件方法：**拒绝，因为现有 API 已能呈现真实的 Session 与 history 事实，而 Host 文件访问需要独立的授权和数据约定。
- **把 Cordis 停靠面与文件 tab 导入 Native：**拒绝，因为这些视图依赖 Native 未安装的 Cordis 服务与资源 Provider。
- **用模型目录表示当前 Session 路由：**拒绝，因为它只公布可选项；durable `request/header` events 才记录 Session 实际使用的路由。

## Consequences

Native 会话详情使用 header 元数据与活动摘要，且不改变 Host 协议。计数与 token 总量仅覆盖 Host 返回的有界历史；用量只统计记录了 usage 的助手事件。Native Provider 提供 Session 作用域的文件事实前，文件浏览和预览均不可用。
