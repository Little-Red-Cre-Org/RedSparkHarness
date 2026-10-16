# Agent Note: Native 侧边栏会话列表交互

Status: implemented

[English](2026-10-16-native-sidebar-session-list-interactions.md) | 中文

## Problem

native-web 侧边栏与旧版 Cordis 侧边栏存在差异，会丢失用户上下文或缺少反馈。点击工作区文件夹行想要折叠时，会同时连接该工作区并选中一个空白会话。回复生成期间点击其他会话没有任何反应。会话菜单没有“删除”，重命名输入框不会获得焦点，按 Esc 也不会关闭；手动排序只有箭头按钮；归档当前打开的会话后，主区仍停留在已隐藏的会话上，标题显示不可用。

## Decision

`rsh/Programs/Web/client/ui-sidebar/src/native-ui.tsx` 中的 `NativeSessionBrowser` 遵循以下规则：

- 点击工作区行、按 Enter 或 Space 只切换折叠状态。在工作区中新建会话仍只由行尾的 `+` 操作负责。
- controller 处于 `sending` 或 `cancelling` 时打开其他会话，会显示 `role="status"` 提示（`session.switchPending`），不切换；controller 恢复就绪后提示消失。处于短暂的 `loading` 状态时的点击会被记住，并在 controller 就绪后打开。搜索结果遵循相同规则。
- 会话菜单在“归档会话”旁显示“删除会话”，与 Cordis 一致。Host 没有真正的删除，因此“删除”先用现有的 `delete.sessionNote` 对话框确认，然后归档。
- 重命名输入框（会话与工作区）打开时获得焦点并选中文本；Esc 取消。
- 归档或删除当前选中的会话后，侧边栏按渲染顺序选中下一条可见行，没有则选中上一条。没有剩余行时调用新增的 `NativeConversationService.deselect()` 清空选择，应用显示空态。
- 手动排序时，工作区内的会话和工作区行可以拖拽排序，通过现有 Host `reorderSession` / `reorder` 调用写入。箭头按钮保留在 DOM 中作为键盘兜底，只在行悬停或获得焦点时显示。

## Alternatives considered

**回合运行中允许切换会话。** 本次不采用：controller 把运行中的回合及其 `sending` 状态绑定在当前选择上，切换需要先完成把回合所有权交给 Host 的回合生命周期改动。在此之前用提示让限制可见。

**归档后提供撤销 toast 和已归档会话列表。** 暂缓：Host 没有提供取消归档的操作。

## Consequences

用户不会再因为点击文件夹或归档而丢失当前对话，被阻止的切换也会说明原因。“删除”和“归档”都只是隐藏会话，文案与 Cordis 一致，但并不提供真正的删除。拖拽排序只在手动排序和按工作区分组视图中可用。

## Testing

`native-application/tests/native-shell.client.spec.tsx` 覆盖：折叠/展开工作区行不调用 `connectWorkspace`、被阻止切换时的提示、重命名的焦点与 Esc、删除确认后选中相邻会话，以及一次会话拖拽排序。`native-controller-follow.spec.ts` 覆盖 `deselect()`。
