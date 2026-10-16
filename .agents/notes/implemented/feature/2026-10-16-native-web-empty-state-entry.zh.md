# Agent Note: Native Web empty-state entry points

Status: implemented

[English](2026-10-16-native-web-empty-state-entry.md) | 中文

## Problem

Native conversation hero 没有可用的 Workspace 选择器；从 sidebar 启动 Session 也可能留下无关的空白 Session。空状态还隐藏了开始任务所需的上下文，而模型选择器和标题栏缺少有用的信息区分。

## Decision

空状态 hero 会打开 Host Workspace 列表；添加 Workspace 或尚无已注册 Workspace 时，可通过目录选择器挑选目录；Host 报告路径不受信任时，会要求用户明确确认。Workspace 连接会选中 `connectWorkspace` 返回的空白 Session。Sidebar 的 New Session 会定位到当前所选 Session 的 Workspace，或最近活动的已注册 Workspace；没有目标时则清空对话。`connectWorkspace` 会复用已有空白 Session，因此这些入口不会创建额外的孤立空白 Session。

只要存在可用的 Agent preset，空状态就会显示预设选择器。用户可暂存一个选择；只有当已选 Session 暴露了该 preset 且尚未锁定时，才会应用一次。Conversation 标题栏显示已选 Session 的 mode，启用 plan 时显示 Plan pill；只有选中 Session 后才渲染 Session 操作。空状态 composer 会提示用户选择 Workspace。没有 effort 选项时，ModelPicker 会直接打开模型列表；同名模型会显示 provider，并将已选模型滚动到可见区域。

此决策扩展了共享 Native Session 所有权与导航策略，见 [Native Web 壳模块](../architecture/2026-10-08-native-web-shell-and-title-ownership.zh.md)和 [Client Session 与 conversation 所有权](../architecture/2026-08-20-client-session-conversation-ownership.zh.md)。

## Alternatives considered

- **每次 New Session 操作都创建新 Session：**拒绝，因为 `connectWorkspace` 已提供该 Workspace 的空白 Session；再创建一个会留下孤立 Session。
- **仅在 sidebar 保留 Workspace 切换：**拒绝，因为用户从 conversation hero 开始第一个任务时，需要在那里为新对话指定 Workspace。
- **在 Session 暴露 mode controls 前应用暂存 preset：**拒绝，因为选择权属于 Host，只能通过未锁定 Session 的可用选项进行应用。

## Consequences

无 Session 时由 hero 提供 Workspace 和 preset 入口；sidebar 通过共享 Workspace client 与 Session controller 解析目标。已有的孤立空白 Session 不会迁移或删除。Workspace trust 仍需用户明确决定；暂存 preset 仅会在新建或连接的 Session 支持它时应用。当 Host 报告目标 Workspace 不可信时，侧栏的 New Session 也会返回空状态；随后由 composer 选择器请求信任，而侧栏在自身的 Workspace 操作中仍保留信任对话框。Workspace 导航会通过 `beginNavigation`/`isCurrentNavigation` 预留 controller 导航令牌，因此较新的选择、清除或导航会取代较慢的待处理连接，与 Cordis `beginNavigation` 一致。
