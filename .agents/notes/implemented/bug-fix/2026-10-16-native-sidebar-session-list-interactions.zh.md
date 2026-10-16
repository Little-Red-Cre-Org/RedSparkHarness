# Agent Note: Native 侧边栏会话列表交互

Status: implemented

[English](2026-10-16-native-sidebar-session-list-interactions.md) | 中文

## Problem

native-web 侧边栏与旧版 Cordis 侧边栏存在差异，会丢失用户上下文或缺少反馈。点击工作区文件夹行想要折叠时，会同时连接该工作区并选中一个空白会话。回复生成期间点击其他会话会被静默忽略。会话菜单没有“删除”，重命名输入框不会获得焦点，按 Esc 也不会关闭；手动排序只有箭头按钮；归档当前打开的会话后，主区仍停留在已隐藏的会话上，标题显示不可用。

## Decision

`rsh/Programs/Web/client/ui-sidebar/src/native-ui.tsx` 中的 `NativeSessionBrowser` 遵循以下规则：

- 点击工作区行、按 Enter 或 Space 只切换折叠状态。在工作区中新建会话仍只由行尾的 `+` 操作负责。
- 回复生成期间打开其他会话会立即切换。`NativeConversationController.select()` 中止当前回合的 detach 信号——这只会停止跟随和等待，不会取消 Host 上的回合——等进行中的操作结束后再选中目标会话。回到仍在运行的会话时，通过现有的 `session/attach` 恢复路径重新接入。只有“停止”会取消回合。处于短暂的 `loading` 状态时的点击会被记住，并在 controller 就绪后打开。搜索结果遵循相同规则。
- 会话菜单在“归档会话”旁显示“删除会话”，与 Cordis 一致。Host 没有真正的删除，因此“删除”先用现有的 `delete.sessionNote` 对话框确认，然后归档。
- 重命名输入框（会话与工作区）打开时获得焦点并选中文本；Esc 取消。
- 归档或删除当前选中的会话后，侧边栏按渲染顺序选中下一条可见行，没有则选中上一条。没有剩余行时调用新增的 `NativeConversationService.deselect()` 清空选择，应用显示空态。
- 手动排序时，工作区内的会话和工作区行可以拖拽排序，通过现有 Host `reorderSession` / `reorder` 调用写入。箭头按钮保留在 DOM 中作为键盘兜底，只在行悬停或获得焦点时显示。

## Alternatives considered

**回合运行中阻止切换并显示提示。** 不采用：回合已由 Host 持有且可重新接入，阻止切换只会保留旧限制；Cordis 客户端可以自由切换。

**归档后提供撤销 toast 和已归档会话列表。** 暂缓：Host 没有提供取消归档的操作。

## Consequences

用户不会再因为点击文件夹或归档而丢失当前对话，回复在后台继续生成时也能切换会话。“删除”和“归档”都只是隐藏会话，文案与 Cordis 一致，但并不提供真正的删除。拖拽排序只在手动排序和按工作区分组视图中可用。

## Testing

`native-application/tests/native-shell.client.spec.tsx` 覆盖：折叠/展开工作区行不调用 `connectWorkspace`、从运行中的回合切走不会取消回合、回来后重新接入、重命名的焦点与 Esc、删除确认后选中相邻会话，以及一次会话拖拽排序。`native-controller-follow.spec.ts` 覆盖 `deselect()`。
