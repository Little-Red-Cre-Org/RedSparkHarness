# Agent Note: 原生 Client Chat 转录视图保持 Cordis-free

Status: implemented

[English](2026-10-11-native-client-chat-transcript.md) | 中文

## 问题

原生 Web 应用曾将 Session 事件显示为格式化记录，而旧版 Chat 视图依赖 Cordis 风格的快照和服务 props。

## 决策

`ui-chat` 发布 Cordis-free 的 `./native` 入口，提供类型化、仅依赖 props 的 Chat 展示。`AssistantMarkdown`、`ReasoningRow`、`UserMessageView`、`StatsPillsView`、`TurnNavigator` 和原生 `ChatView` 共用 Chat 自有样式以及类型化的中英文词典。旧版 `MessageItem` 和 `StatsPills` 保留 Client 适配器，并复用拆出的用户消息视图和统计视图。

`ui-conversation` 发布 Cordis-free 的 `./native` 入口，提供使用主题 token 的滚动 shell。原生应用将选中 Session 的事件窗口投影为 Chat 视图类型，使用现有的根级 Tool 展示器，并在持久化消息旁显示实时助手文本。统计数据取自已加载事件中的计时、记录的 token 用量以及共享的流首 token 辅助函数。

## 考虑过的替代方案

**加载旧版 Chat 组装。** 其快照选择器、Conversation hooks 和扩展注册表属于 Cordis Client 组装，会让原生依赖图加载旧版插件包。

**将转录组件复制到原生应用。** 这会在仅负责 Session 到视图投影的包中重复 Chat 标记、样式、本地化键和视图行为。

## 后果

原生应用声明 `ui-chat`、`ui-conversation` 和 `dsh-llm` 运行时依赖，并且只通过 native 入口访问展示代码。旧版 renderer 仍通过现有 Client 入口提供，并复用拆出的视图。

原生轮次导航仅覆盖已加载事件；Host 轮次大纲分页、队列展示、嵌套 Tool 分派和其他事件专属的旧版行仍不属于此转录。原生转录和旧版 Chat 的定向测试覆盖共享渲染路径，原生依赖门禁检查导入保持 Cordis-free。
