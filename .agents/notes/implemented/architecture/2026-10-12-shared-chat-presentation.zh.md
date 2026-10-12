# Agent Note: 在 Client 组合间共享聊天展示

Status: implemented

[English](2026-10-12-shared-chat-presentation.md) | 中文

## Problem

旧 Cordis 聊天页与 Native 对话页需要相同的消息、composer、流式输出和空状态展示，但 Native Client 不能依赖旧功能包。

## Decision

`ui-primitives` 持有无 Cordis 的聊天展示组件及其 token 样式。Legacy chat 与 Native conversation 共用相同的转录节奏、用户气泡、助手 Markdown 外框、折叠推理行、消息复制操作、运行中轮次标签、composer 卡片与工具栏控件、欢迎页主视觉和吉祥物舞台。`ui-chat` 的旧 ReasoningRow 和 MessageIconActions 适配器复用共享的推理展示与操作行。Native 按轮次分组持久化消息和根级 Tool 卡片，并从 Session 事件投影每条助手消息的用量、耗时和时间。每种组合仍自行持有数据投影和本地化文案。Native 根级 Tool 卡片与持久图片 renderer 仍由调用方持有。对话标题读取 Native 会话列表中的 Session 标题，并用 pill 标记固定的对话视图；右侧详情操作仍由 slot 提供。Native 当前显示内置吉祥物图集，不读取桌宠偏好或自定义形态。

Native composer 只展示选定 Host Consumer 已公布的数据与操作。Native 对话状态提供模式之前，模式选择保持禁用；标题中的 Chat pill 只标识固定视图，不切换模式。本次变更不增加 Host API。

## Alternatives considered

**让 Native 导入旧版 `ui-chat` 或 `ui-conversation`。** 这些功能包包含 Cordis 与 slot 依赖，其数据持有者也与 Native Host Consumer 不匹配。

**把旧版标记和 CSS 复制到 Native。** 这会重复展示约定，并让两种 Client 组合在本次移植后继续分化。

**让 Native 保持独立展示。** 这保留了包边界，但无法满足两种组合共享视觉行为的要求。

## Consequences

共享包持有展示与剪贴板复制行为，但不持有 Session 事实或 Host 操作。Native 保留既有 append-origin 投影、模型控件、审批流程、Tool 卡片和图片加载。当前 Native consumer 未提供状态或操作的功能仍不可用，包括模式与计划选择、轨迹导航、消息反馈、命令补全以及排队/引导控件。
