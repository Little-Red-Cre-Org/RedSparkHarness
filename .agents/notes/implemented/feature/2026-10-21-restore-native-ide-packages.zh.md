# Agent Note: Restore the Native IDE provider packages

Status: implemented

[English](2026-10-21-restore-native-ide-packages.md) | 中文

## Problem

一个已经与主仓库失联的 worktree 里放着一份未完成的 Native IDE 切片：一个 Code OSS provider，以及消费它的 profile application。那个 worktree 的仓库已经丢失，唯一存下来的副本是以 `restore/startup-20261021` 推上去的文件快照。该快照早于产品改名，所以它的 manifest、import 和标识符全都写着上游产品名；而 `main` 里这两个包一个都没有。代码存在，但已发布的源码树里没有任何东西能对它做类型检查。

## Decision

只恢复让这个 provider 可用的两个包，其余不动：

- `rsh/Modules/Official/ide/ide-code-oss` —— Native Provider。它从 profile 配置解析绝对路径的 Code OSS 运行时、工作区与数据目录，通过 `subprocess` 服务持有一个 `127.0.0.1` 服务器进程，并把结果 URL 与退出 promise 作为 `ide` 服务发布。
- `rsh/Programs/Web/host/native-ide` —— application。它 require `ide`、provide `application`，并阻塞到取消或服务器退出。

两者都登记进 `native-package-policy.ts`，既是源码归属方，也是 Host-only 编译面。原因是 `verify-native-dependencies` 的准入图来自该文件；未登记的 native 包即使能编译也过不了门禁。

Desktop 侧的集成——Electron IDE 窗口、VSIX adapter、handoff 协议和 Web workbench UI——不在本次改动内。这些层依赖 `main` 已不存在的 Desktop 接线，恢复它们是另一个决定，需要单独的评审面。

## Alternatives considered

- **整条合并 `restore/startup-20261021`：** 否决。该分支是整份 worktree 快照，其根历史与 `main` 无共同祖先，而它缺失的 197 条路径里有 141 条是移动而非丢失。合并它会重写无关的包。
- **原样复制快照文件：** 否决。这些文件里的每个 manifest、import 和标识符都写着上游产品名。`pnpm install` 与 `tsc -b` 会在第一个被改名的 workspace 依赖上失败。
- **同一次改动里恢复 Desktop 窗口：** 否决。那一层需要 Electron 接线、随包 VSIX 和 handoff 协议；一并塞进来会掩盖 provider 边界究竟在哪。

## Consequences

Native 图多了一个 Provider 和一个 application，`main` 现在可以构建、类型检查并校验它们。选择 `native-ide` 的 profile 仍然需要一个装在绝对路径上的 Code OSS REH Web 发行版；本次改动不下载、不打包、也不认证任何发行版。Desktop 窗口、扩展适配器和产品内 workbench 仍未实现，所以这次恢复的是能力 seam，而不是用户能打开的那个编辑器。
