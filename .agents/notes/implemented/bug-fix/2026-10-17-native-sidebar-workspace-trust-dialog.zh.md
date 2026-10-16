# Agent Note：原生侧栏工作区信任对话框

Status: implemented

[English](2026-10-17-native-sidebar-workspace-trust-dialog.md) | 中文

## 问题

native-web 侧栏遇到配置根目录以外的 Workspace 路径时，会询问用户是否信任该路径，然后带 `trust` 重试。有四处缺口导致对话框不出现，或拒绝原因说不清：

- 从源码运行时，profile 打包器会解析仓库别名，侧栏检查的可能是源码中的 `NativeSessionRpcError` 类，而 native-session 客户端抛出的是构建产物中的类。`instanceof` 失败，信任拒绝只显示为普通文本。
- 从列表或搜索结果打开已有 Session 时直接调用 `select()`。对尚未启动且未受信任的 Workspace，Session RPC 在路由准入时失败，返回通用的 `native/session` 错误，会话控制器只保留其文本。信任对话框不会打开。
- 侧栏折叠时，添加 Workspace 按钮会设置选择器状态，但折叠布局不渲染目录浏览器，因此按钮没有效果。
- 受保护的系统目录显示 Host 的英文消息 `Workspace is a protected system directory`，没有用用户语言说明原因。

## 决策

[`dsh-client-ui-sidebar`](../../../../rsh/Programs/Web/client/ui-sidebar/README.zh.md) 按 `code`（`native/workspace-untrusted`、`native/workspace-forbidden`）识别原生 RPC 拒绝，并从 `details.path` 读取未受信任的路径，不再使用 `instanceof NativeSessionRpcError`。

Session 行和搜索结果与 Workspace 行一样，通过 `runWorkspaceAction` 打开。注入的 `selectSession(id, trust?)` 找到 Session 所属的已注册 Workspace，在 `controller.select(id)` 之前用其路径调用 `workspaces/create`（批准后带上 `trust`）。`workspaces/create` 会把已有路径解析为对应 Workspace 并为其路由完成准入，因此未受信任的 Workspace 会返回带路径的 `native/workspace-untrusted`，批准后经由现有 Host 路径持久化信任。没有已注册 Workspace 的 Session 仍像以前一样直接选择。

折叠布局渲染与展开布局相同的 `DirectoryBrowser`。遇到 `native/workspace-forbidden` 拒绝时，目录浏览器或侧栏提示显示 `workspaceForbidden` 本地化文本（英文和中文），说明该目录是受系统保护的目录，代理在其中运行可能修改或损坏系统文件。

## 考虑过的替代方案

**保留 `instanceof`，让 profile 打包与仓库别名隔离。** 本次未采用：这会改变所有原生客户端产物的解析方式，而错误码和 details 已经足以识别拒绝；按错误码检查不受加载了几份类副本的影响。

**让 Session RPC 返回 `native/workspace-untrusted`，并在会话控制器中保留其结构。** 未采用：这会改动 Session 控制器的线协议和控制器错误状态，而 Workspace 准入已经有支持信任的 RPC，侧栏的 Workspace 行也在使用它。

**在客户端按英文文本匹配 Host 消息并翻译。** 未采用：稳定的 `native/workspace-forbidden` 错误码已经存在，而文本匹配会在 Host 措辞变化时失效。

## 影响

打开已注册 Workspace 中的 Session 时，加载前会多一次 `workspaces/create` 调用。如果 Workspace 目录已不存在或被禁止，错误显示在侧栏提示中，而不是会话区域。侧栏的 New Session 按钮仍走自己的路径，本次不涉及。

## 验证

`rsh/Programs/Web/client/native-application/tests/native-shell.client.spec.tsx` 在打开已有 Session 时让 Workspace 创建以携带 `native/workspace-untrusted` 的普通 `Error` 拒绝，然后检查信任对话框会打开，且批准后在 Session 加载前带 `trust: true` 重试。它还让目录采用以 `native/workspace-forbidden` 拒绝，并检查本地化的原因。源码运行的截图附在 PR 中。
