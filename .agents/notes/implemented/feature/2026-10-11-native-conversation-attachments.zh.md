# Agent Note: Native conversation attachments reuse shared presentation

Status: implemented

[English](2026-10-11-native-conversation-attachments.md) | 中文

## Problem

Native Web 对话可以上传已记录的图片并呈现持久化图片引用，但 composer 没有提供遵循限额的选择器、拖放目标、待处理图片栏或可复用的灯箱呈现。

## Decision

`@deepseek-ai/dsh-client-ui-attachment` 通过 `./native` 导出不依赖 Cordis 的呈现组件，与旧版 `./client` 插件分开。`native-application` 负责图片选择、公布限额检查、本地化拒绝提示、图片 Blob URL 和 Host 图片读取。它复用 `AttachmentRail`、`DropOverlay`、`FileCard`、`MessageImage` 与 `ImageLightbox` 组件。`MessageImage` 保留对 `@deepseek-ai/dsh-attachment/types` 的纯类型引用。

composer 只接收媒体类型和大小符合所选模型图片限额的文件，并遵守每条消息的图片数量和总字节数限制。持久化消息图片通过所选 Session 的 `loadImage(sessionId, image, signal)` 操作加载；草稿和已加载图片的 Blob URL 会在所有者释放时撤销。

## Alternatives considered

- **在 Native 应用中导入旧版附件插件。** 其 Cordis 插件入口拥有旧版 slot，会让不依赖 Cordis 的 Native Client 包耦合到浏览器插件生命周期。
- **在 `native-application` 中重建附件界面。** 这会重复维护 `ui-attachment` 已有的附件栏、拖放遮罩、图片尺寸和灯箱行为。

## Consequences

- Native Web 通过共享组件提供受模型限额约束的图片选择、页面拖放、可移除缩略图和历史图片预览。
- Native 应用负责接收图片和读取 Host；共享呈现组件独立于 Cordis、Session 服务和 Native 应用状态。
- 通用文件与更广泛的资源管理不属于 Native composer。
