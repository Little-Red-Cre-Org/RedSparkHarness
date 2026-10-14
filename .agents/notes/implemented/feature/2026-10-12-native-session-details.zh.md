# Agent Note：Native 会话详情使用已观察事实与可选工作区文件

Status: implemented

[English](2026-10-12-native-session-details.md) | 中文

## Problem

Native 会话详情位于 legacy Cordis Sidebar 旁边，但属于独立组合。Session roster 与 history 暴露对话事实；工作区访问来自可选的 `clientNativeWorkspaceFiles` 服务。Native 不得导入 Cordis tab，也不得在服务缺失时暗示具备文件访问能力。

## Decision

`ui-sidebar-right` 的 Native 入口通过当前 Session header 与 roster 提供“概览”，通过 `NativeSessionClient.history()` 提供“活动”：durable 轮次、用户与助手消息、工具调用、已记录 token 用量、最近一次请求路由和上下文窗口。统计范围仅限 Host 返回的历史记录。

注册了 `clientNativeWorkspaceFiles` 时，同一面板会增加“文件”和“预览”。“文件”按需列出工作区相对目录；点击文件会将它选为预览内容。文本分页调用 `read`；HTML、图片和 PDF 完整内容调用 `readAll`；HTML 直接声明的相对脚本与样式表调用 `readRelated`，并在不透明的 `sandbox="allow-scripts"` iframe 中运行。`follow` 会刷新已展开目录。`ui-primitives` 持有 props-only 树行以及 Native 与 legacy 适配器共用的代码、Markdown、HTML、图片和加载展示。

预览读取拥有分页以及主文件和成功加载的 HTML 依赖身份；版本变化或删除会使该读取失效，无关路径和相同版本保留已显示的页面。读取响应发布前会将读取期间收到的 observation 与响应的实际绝对路径和版本比较，避免旧响应掩盖新 observation。失败读取不返回身份，因此预览失败后，已知身份之外的新文件存在 observation 会触发重试；缺失 observation 和已知同版本不会触发该恢复重试。预览成功后继续按已知路径与版本过滤。重新展开目录会刷新列表，文本分页按行数保留空页。

## Alternatives considered

- **要求整个面板都必须有工作区文件服务：**拒绝，因为没有可选文件服务的组合仍可使用 Session 概览与活动摘要。
- **导入 legacy Cordis 文件树与预览插件：**拒绝，因为这些入口依赖 Native 未安装的 Cordis 注册、Remote slot 与资源 Provider。
- **用模型目录表示当前 Session 路由：**拒绝，因为它只公布可选项；durable `request/header` events 才记录 Session 实际使用的路由。

- **每次工作区 observation 都刷新预览：**拒绝，因为无关文件会丢弃分页，而相同版本读取产生的 observation 可能引发重复刷新。面板只跟踪当前读取返回的身份，包括允许加载的 HTML 依赖。

## Consequences

仅当 Host 组合提供可选服务时，Native 会话详情才显示工作区文件。视图保持只读，不改变 Session event 格式。文本按页读取；完整文件受 Host 文件大小上限约束。HTML 只会收到有界、直接声明的静态资源；iframe 不会获得文件读取回调。

## Verification

文件面板 owner 测试覆盖空页、目录重新展开、无关路径及同版本 observation、过期分页的成功和失败、首次读取响应前收到新 observation，HTML 打包后依赖版本变化，以及首次打包失败后创建原本缺失的依赖。首次读取和已加载依赖的审查探针在初始 P2 修复中失败，在响应发布前检查 observation 并跟踪依赖后通过。另一个 fixture 参数在后续云端检查点的首次依赖读取拒绝时失败，加入 observation 触发的失败读取恢复后通过。这些测试使用现有组件 fixture，不声称完成真实浏览器回放。
