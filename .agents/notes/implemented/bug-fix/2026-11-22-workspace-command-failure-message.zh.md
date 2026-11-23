# Agent Note: Workspace command failures keep their message

Status: implemented

[English](2026-11-22-workspace-command-failure-message.md) | 中文

## Problem

对非核心目录（包括系统临时根下的路径）执行 `workspaces/connect` 时，空白 Session 的物化阶段可能失败。物化会取得写租约，该租约会通过 `tryLockExclusive` 加载 `system.node`。插件缺失时，headless 抛出包住 `flock.ts` 模块错误的 `native-headless: turn cleanup failed`。`NativeWebWorkspaceService.handle` 把短允许列表之外的失败都换成 `Workspace request failed.` 和 `native/workspaces`。浏览器横幅显示该 RPC 消息，操作者看不到原因。临时路径不是受保护的系统目录：插件存在时，创建和连接都会成功。

## Decision

除根目录外和受保护目录之外，`workspaces/*` 失败返回 `native/workspaces` 和 `workspaceFailureMessage`。该文本就是抛出的消息。`AggregateError` 会附上每一条嵌套消息。非 `Error` 使用 `String(value)`。根目录外结果仍是带 `{ path }` 的 `native/workspace-untrusted`。受保护目录仍是 `native/workspace-forbidden`。无效的 `workspaces/follow` 请求体仍返回 `Workspace request failed.`。目录命令仍使用 `native/directories` 和通用消息。

## Alternatives considered

### 为什么不把缺失插件的文案加入允许列表？

该消息包含文件系统路径和清理标题，其他准入失败也以同样方式被隐藏。允许列表无法事先列出它们。

### 为什么不导入 Session 的 `errorMessage`？

`native.ts` 已经导入 `workspaces.ts`。本地函数使用相同的嵌套消息文本，且不形成循环。新建共享模块只会搬走这三行。

### 为什么不为缺失插件增加路由准入错误码？

插件失败发生在 Session 物化期间，不是目录拒绝。临时根下的路径仍然可以准入。新错误码不会指出缺失的文件。

## Consequences

- 被拒绝的 workspace 命令在现有 `native/workspaces` 结果中显示抛出的消息，包括嵌套的 `AggregateError` 消息。客户端已经渲染 `error.message`。
- 受保护目录和 `allowedRoots` 之外的路径保留现有错误码与 details。
- 无效的 follow JSON 仍使用通用消息。
- 消息可以包含底层错误里的文件系统路径，与 Session 失败已经公开的内容相同。

## Verification

`workspace-connect.host.spec.ts` 连接系统临时根下的目录，即使调用方传入 `trust: true` 也拒绝受保护的系统目录，拒绝 `allowedRoots` 之外的目录并带上规范路径，并报告嵌套的 `AggregateError`，而不是 `Workspace request failed.`。
