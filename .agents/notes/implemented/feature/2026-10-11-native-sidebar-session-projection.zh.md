# Agent Note: Native sidebar session projection

Status: implemented

[English](2026-10-11-native-sidebar-session-projection.md) | 中文

## Problem

原生 Session 与 Workspace 客户端提供 Host Workspace 注册表、有序的 Session 成员关系、活动时间戳、Session 状态和目录浏览。原生侧边栏使用这些数据流，并通过注入的 UI owner 调用宿主操作。

## Decision

原生侧边栏按 Host 注册表的 `workspaceId` 对 Session 分组，并使用每个 Workspace 有序的 Session 成员关系。它还支持平铺 Session 视图、按最近活动或手动排序、Session 搜索与归档、Workspace 重命名与删除，以及通过目录选择创建 Workspace。共享的零 Cordis 行组件提供与 legacy 侧边栏相同的状态、活动时间、悬停路径和行菜单。

展开 Workspace 只改变可见分组。其新会话操作通过 `connectWorkspace` 打开或创建可复用的空白 Session。侧边栏还会打开只读定时任务面板，详见 [Native 定时任务列表记录](2026-10-12-native-scheduled-task-list.zh.md)；当前组合未提供拖动排序、移动 Session 或多页搜索。

按 Workspace 分组的手动排序提供上移/下移控件，调用已有 Workspace 重排与 Session 重排命令。Host follow 提供最终顺序；侧边栏只保留一个写入等待标记，操作结算前禁用排序控件，失败时显示错误，不乐观重排。隐藏的归档或空白成员保留注册位置；移动以相邻可见成员为锚点，移到可见末尾时追加到 Host 成员列表。Ungrouped 与平铺行没有排序控件。

## Alternatives considered

- **把每个 cwd 当作 Workspace 身份：**拒绝，因为 Host 注册表提供 Workspace id、成员关系和顺序。
- **在 Native 组合中复制 legacy 行与目录浏览器 UI：**拒绝，共享零 Cordis 展示组件可保持两个侧边栏一致，同时让 Host 操作留在其 owner 中。
- **等 Schedule 数据流就绪后再渲染 Workspace 导航：**拒绝，因为 Workspace 与 Session 数据流本身已支持侧边栏的核心导航。

## Consequences

原生侧边栏的 Workspace 与 Session 行使用 Host 注册表和 Session 摘要数据。定时任务列表保持只读；此组合不提供拖动手势、Session 移动和更多搜索结果页。
