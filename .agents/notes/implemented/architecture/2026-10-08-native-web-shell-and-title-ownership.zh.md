# Agent Note: 原生 Web 壳模块共用一个 Session authority

Status: implemented

[English](2026-10-08-native-web-shell-and-title-ownership.md) | 中文

## 问题

显式 native-web profile 可以呈现对话，但缺少可独立选择的导航壳、外观控制和 Session 详情界面。直接复用旧壳会引入 Cordis 注册路径，而将其复制进应用又会重复现有的 Session 与布局所有权。

## 决策

native-web template 选择六个可选 Client 安装器，分别负责 locale、theme、Session presentation、layout、左侧 sidebar 和右侧详情 sidebar。它们通过现有 Native slot runtime 组合，并复用 `NativeConversationController`、Native 布局 store 及既有 theme 和 locale service。每个安装器都声明自己的能力依赖并负责清理；sidebar 通过 Session presentation 合同取得标题显示行为，不导入其他 feature package 的运行时实现。

Session 标题仍是从 Session 历史投影的持久化 `session/title` 事实。自动 Provider 工作在 idle observer 捕获当前输入并提交 fallback 后启动。service 为该后台任务保留确切的 ActiveSession owner，并在 Provider 完成或失败时释放。Rename 和 refresh 通过调用方现有的 RootExecution 能力委派执行；它们不会创建新的 writer 或标题 store。owner 脱离和 service 销毁时会取消并排空 Provider 与 maintenance 工作，因此提示结算不必等待辅助 Provider，同时安全卸载仍会等到已准入工作结束。

可见 Workspace 标签来自所选 Session header 的 `cwd`；此壳不提供 Workspace 列表、创建、搜索、移动或删除行为。native-web profile 显式选择这些模块。兼容应用仍为默认，本次变更不选择 P5 默认 profile。

## 考虑过的替代方案

**把旧壳复制到一个 Native application 模块。** 拒绝，因为这会重复呈现与 Session 所有权，把导航绑定到一个大型安装器，并阻止其他 Native 组合只选择所需壳能力。

**复用依赖 Cordis 的旧 sidebar 和 layout 注册。** 拒绝，因为 Native Client entry 必须能在不导入旧 Cordis 注册或 service 路径的情况下运行。

**在 Session idle callback 中等待标题生成。** 拒绝，因为活动 Program 的结算会等待已准入的 idle observer，缓慢的可选 Provider 会让用户当前轮次继续挂起。保留 owner 的后台任务可以分离提示结算，同时保持取消和持久化写入所有权。

## 后果

Native 壳由多个可选 feature module 组装，共用一个 slot renderer、一个 Session controller 和一份 Session 历史。取消后，缓慢 Provider 仍可能继续占有 Session 直到结束；卸载会排空任务，而不会在 writer 仍可能活动时释放 owner。Workspace CRUD、attachments 与 login 不属于此壳功能组；本批不声称旧默认组合或 Electron 部署已验收。
