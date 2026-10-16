# Agent Note: Native composer errors, drafts, paste and keyboard focus

Status: implemented

[English](2026-10-16-native-composer-errors-keyboard.md) | 中文

## Problem

2026-10-16 native-web 可用性审计发现：Native 页面直接显示原始异常文本，不提示用户配置模型（N12）；切换 Session 会丢失未发送的草稿和图片（N23）；不能粘贴图片，也不能只发图片（N24）；Tab 会离开设置对话框（N29）；侧栏是 `role="tree"` 却没有方向键行为（N30）。Esc 不能停止正在运行的回合（N11）。当时 `application.tsx` 的输入框结构由另一个变更负责，因此本变更只落地该文件之外的部分。

## Decision

- **N12。** `ConversationError`（`native-application/src/conversation-error.tsx`）为原始会话错误显示本地化文案，凭据失败时提供“打开模型设置”操作，并在可展开区域保留原文。认证失败文案与 Cordis（`message.failure.auth`）一致。native prompt RPC 以 `native/session` 消息文本报告模型失败，不带 `LlmError` code，因此组件按 adapter 的消息措辞识别凭据缺失和被拒绝。`requestNativeModelSettings` 派发 window 事件，`NativeSidebarSettings` 收到后在“模型”页打开设置，沿用繁忙发送偏好事件的模式。
- **N23。** controller 通过 `keepDraft` 和 `takeDraft` 按 Session 保存一份未发送草稿（文本和图片文件）；这是呈现状态，不会到达 Host。
- **N24。** `NativeComposerAttachments` 接收粘贴到所在 composer 表单的剪贴板文件，并与选择和拖放走同一限额过滤。`send` 接受空文本加图片，改用带 image part 的 `promptContent`。
- **N29。** `SettingsPanel` 在对话框首尾循环 Tab 和 Shift+Tab，把外部焦点拉回对话框，关闭时把焦点还给打开它的元素。
- **N30。** Native 侧栏树只有一个漫游 Tab 停靠点。Tab 只进入树一次，并把焦点转到选中行或第一行；上下方向键、Home 和 End 在行间移动；Enter 和 Space 保留行原有的激活行为。
- **`application.tsx` 中仍需完成。** 用 `ConversationError` 替换原始错误行；切换 Session 时保存和恢复草稿；回合运行时 Esc 调用 `cancel()`；在输入框判断中允许只发图片；把附件栏移出工具栏这一行。

## Alternatives considered

- **在 controller 快照中分类错误。** controller 会多出一个由同一字符串派生的错误字段；在渲染时分类可只保留一个错误值。
- **通过 native RPC 转发 `LlmError` code。** 这是准确信号，但会改变 Host 传输结果及其消费者；它仍是可替代消息匹配的后续工作。
- **N11 使用全局 Escape 监听。** Escape 已用于关闭对话框、菜单和图片灯箱；页面级监听会在关闭它们时同时停止回合。
- **工作区行支持左右方向键。** 目前切换 native 工作区行的折叠还会新建并选中 Session（审计 N16），因此展开/折叠键要等该问题修复。

## Consequences

- 如果 adapter 的消息不使用已识别的措辞，凭据失败仍显示通用失败文案和详情。
- 草稿只在页面生命周期内跨 Session 切换保留；刷新后丢弃。
- `SettingsPanel` 的焦点限制同样作用于共用该 primitive 的 Cordis 设置根。
