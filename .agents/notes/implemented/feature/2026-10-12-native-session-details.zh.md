# Agent Note：Native 会话详情使用已观察事实与可选工作区文件

Status: implemented

[English](2026-10-12-native-session-details.md) | 中文

## Problem

Native 会话详情位于 legacy Cordis Sidebar 旁边，但属于独立组合。Session roster 与 history 暴露对话事实；工作区访问来自可选的 `clientNativeWorkspaceFiles` 服务。Native 不得导入 Cordis tab，也不得在服务缺失时暗示具备文件访问能力。

## Decision

`ui-sidebar-right` 的 Native 入口通过当前 Session header 与 roster 提供“概览”，通过 `NativeSessionClient.history()` 提供“活动”：durable 轮次、用户与助手消息、工具调用、已记录 token 用量、最近一次请求路由和上下文窗口。统计范围仅限 Host 返回的历史记录。

注册了 `clientNativeWorkspaceFiles` 时，同一面板会增加“文件”和“预览”。“文件”按需列出工作区相对目录；点击文件会将它选为预览内容。文本分页调用 `read`；HTML、图片和 PDF 完整内容调用 `readAll`；HTML 直接声明的相对脚本与样式表调用 `readRelated`，并在不透明的 `sandbox="allow-scripts"` iframe 中运行。文件变化后，`follow` 会刷新已展开目录和所选预览。`ui-primitives` 持有 props-only 树行以及 Native 与 legacy 适配器共用的代码、Markdown、HTML、图片和加载展示。

## Alternatives considered

- **要求整个面板都必须有工作区文件服务：**拒绝，因为没有可选文件服务的组合仍可使用 Session 概览与活动摘要。
- **导入 legacy Cordis 文件树与预览插件：**拒绝，因为这些入口依赖 Native 未安装的 Cordis 注册、Remote slot 与资源 Provider。
- **用模型目录表示当前 Session 路由：**拒绝，因为它只公布可选项；durable `request/header` events 才记录 Session 实际使用的路由。

## Consequences

仅当 Host 组合提供可选服务时，Native 会话详情才显示工作区文件。视图保持只读，不改变 Session event 格式。文本按页读取；完整文件受 Host 文件大小上限约束。HTML 只会收到有界、直接声明的静态资源；iframe 不会获得文件读取回调。
