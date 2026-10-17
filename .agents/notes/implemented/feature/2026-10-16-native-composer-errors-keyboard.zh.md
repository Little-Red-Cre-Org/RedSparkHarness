# Agent Note: Native composer errors, drafts, paste and keyboard focus

Status: implemented

[English](2026-10-16-native-composer-errors-keyboard.md) | 中文

## Problem

2026-10-16 native-web 可用性审计发现：Native 页面直接显示原始异常文本，不提示用户配置模型（N12）；切换 Session 会丢失未发送的草稿和图片（N23）；不能粘贴图片，也不能只发图片（N24）；Tab 会离开设置对话框（N29）；侧栏是 `role="tree"` 却没有方向键行为（N30）。Esc 不能停止正在运行的回合（N11）。

## Decision

- **N11。** 回合发送中时，在 composer 文本框按 Esc 调用 `cancel()`；输入法组字期间或已在取消时不响应。用户取消的回合（Esc 或停止按钮）结算后回到就绪，不发布错误。
- **N12。** `ConversationError`（`native-application/src/conversation-error.tsx`）为原始会话错误显示本地化文案，凭据失败时提供“打开模型设置”操作，并在默认折叠的可展开区域保留原文。该提示是位于对话记录末尾（失败回复应出现处）的卡片。认证失败文案与 Cordis（`message.failure.auth`）一致。native prompt RPC 以 `native/session` 消息文本报告模型失败，不带 `LlmError` code，因此组件按 adapter 的消息措辞识别凭据缺失、空白或不可用的密钥以及被拒绝的凭据，且只把 `native-model-execution` 模型错误中的 401/403 视为认证失败，Host 与 Connection 的 HTTP 失败保持通用文案。`requestNativeModelSettings` 派发 window 事件，`NativeSidebarSettings` 收到后在“模型”页打开设置，沿用繁忙发送偏好事件的模式。
- **N23。** controller 通过 `keepDraft` 和 `takeDraft` 按 Session 保存一份未发送草稿（文本和图片文件）；这是呈现状态，不会到达 Host。选中的 Session 变化时，composer 保存离开的 Session 的草稿，并恢复进入的 Session 的草稿。Host 未接纳的发送（`session/start` 未返回，例如在图片读取或启动期间切换了 Session）报告失败；若仍在该 Session 且输入框为空，文本和图片回到输入框，若已切走则存入原 Session 的草稿；归档或删除 Session 时丢弃其草稿。
- **N24。** `NativeComposerAttachments` 接收粘贴到所在 composer 表单的剪贴板文件，并与选择和拖放走同一限额过滤。`send` 接受空文本加图片，改用带 image part 的 `promptContent`；排队和插话仍只发文本。缩略图栏在输入框上方单独占一行，不再把模型控件挤到第二行；'+' 选择按钮（`NativeComposerImagePicker`，打开缩略图栏的文件输入）留在工具栏，与模型控件同排。
- **N29。** `SettingsPanel` 在最顶层模态对话框（设置本身或其上打开的确认框）首尾循环 Tab 和 Shift+Tab，把外部焦点拉回对话框，关闭时把焦点还给打开它的元素。
- **N30。** Native 侧栏树只有一个漫游 Tab 停靠点。Tab 只进入树一次，并把焦点转到选中行或第一行；上下方向键、Home 和 End 在行间移动；右方向键展开、左方向键折叠工作区行；Enter 和 Space 保留行原有的激活行为。

## Alternatives considered

- **在 controller 快照中分类错误。** controller 会多出一个由同一字符串派生的错误字段；在渲染时分类可只保留一个错误值。
- **通过 native RPC 转发 `LlmError` code。** 这是准确信号，但会改变 Host 传输结果及其消费者；它仍是可替代消息匹配的后续工作。
- **N11 使用全局 Escape 监听。** Escape 已用于关闭对话框、菜单和图片灯箱；页面级监听会在关闭它们时同时停止回合。

## Consequences

- 如果 adapter 的消息不使用已识别的措辞，凭据失败仍显示通用失败文案和详情。
- 草稿只在页面生命周期内跨 Session 切换保留；刷新后丢弃。
- `SettingsPanel` 的焦点限制同样作用于共用该 primitive 的 Cordis 设置根。
