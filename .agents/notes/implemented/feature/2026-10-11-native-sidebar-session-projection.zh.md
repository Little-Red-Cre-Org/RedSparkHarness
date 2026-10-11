# Agent Note: Native sidebar session projection

[English](2026-10-11-native-sidebar-session-projection.md) | 中文

Status: implemented

## Problem

原生 Session 客户端提供已存储的 header 和标题操作，但没有 Workspace 注册表、活动时间排序或跨 Session 状态流。原生侧边栏仍需要提供可用的导航，同时不能把路径分组说成 Host Workspace。

## Decision

原生侧边栏按 `SessionHeader.cwd` 将已列出的 Session 组成纯客户端展示分组。分组没有 `WorkspaceId`；标签由 `workspaceLabel(cwd)` 生成，未分组使用本地化标签。分组和 Session 行按当前可用的最新 `header.createdAt` 排序。侧边栏使用 `NativeSessionPresentation.displayTitle` 以及现有的重命名和刷新标题操作。

由于原生列表不提供 `updatedAt`、待处理交互、运行状态或完成状态，展示层不显示相对活动时间或 Session 状态。Workspace 创建、搜索、排序控件和定时任务在对应 Host 服务可用前保持禁用。路径分组不显示仅适用于 Workspace 的操作。

## Alternatives considered

- **把每个 cwd 当作 Workspace 身份：**拒绝，因为 Workspace 归属和顺序由 Host 管理；路径不能提供 Workspace id 或有序的 Session 成员关系。
- **从创建时间、当前选中历史或占位值推导活动时间和状态：**拒绝，因为这些值会错误描述 Session 当前状态。
- **等 Workspace 和定时任务 API 全部就绪后再渲染侧边栏：**拒绝，因为现有 Host 已支持列出、选择、创建和重命名 Session。

## Consequences

原生侧边栏现在提供分组 Session 导航和标题管理，但尚不提供注册 Workspace 行为。原生 Workspace 和 Session 摘要流就绪后，应改用其权威成员关系、手动顺序、活动时间和状态值替换 cwd 投影；不能把 cwd 转成持久 Workspace 身份。
