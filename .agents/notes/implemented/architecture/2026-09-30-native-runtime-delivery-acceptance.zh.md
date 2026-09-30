# Agent Note: 原生运行时交付验收

Status: implemented

[English](2026-09-30-native-runtime-delivery-acceptance.md) | 中文

## Problem

原生运行时迁移需要一份持久交接记录，区分已经验证的产品路径、仅兼容路径和本机无法执行的平台检查。

## Decision

原生默认装配和包闭包以合并提交 `1de1837e3ae8a49f8959957267e2602e87114d98` 作为已交付的 P5 基线。

验收记录把原生运行时、原生 Engine 包、原生 filesystem 与 headless profile、原生 Web Client、Desktop Host、CLI 可选依赖检查、原生打包消费者和无 Cordis 声明作为原生产品范围。

兼容范围保持显式：Cordis、Loader、HMR、旧 profile boot 和五条已审查的 runtime-layer 边仍位于兼容或旧入口之后；`collectRuntimeLayerViolations` 会在对应 manifest 边消失时拒绝每条例外。

Windows 的本地交付路径是合并后 P5 工作树中的 source Desktop 启动器。它从原生 Desktop 构建启动 Electron，并使用隔离的 `DSH_HOME`；本机 Visual Studio 缺少补丁 `node-pty` 构建所需的 Spectre 缓解库，因此未验证已安装 unsigned 包路径。

## Evidence

- P5 合并前已通过 `pnpm run build`、`pnpm run typecheck`、`pnpm run lint`、`pnpm run hygiene`、`pnpm run doc-sync` 和 `pnpm run verify-third-party-notices`。
- 无 Cordis 的生产消费者夹具已通过原生打包消费者测试。
- 构建 CLI E2E 在启动器从子进程 stderr 断言中移除 Node 24 SQLite warning 后通过。
- GitHub Actions 运行 `36662253793` 通过原生 addon 矩阵；运行 `36662253803` 通过 Linux 和 Windows RSH CI，包括构建、类型检查、终端回归、profile smoke、Client 测试、lint 和文档检查。
- 已从合并工作树观察 Windows source Desktop 启动，Electron 44 进程和配置的 inspector 端口均出现；更新后的 GUI、Web 和 TUI 快捷方式解析到同一个工作树启动器。

## Compatibility matrix

| Surface | Supported path | Evidence or limit |
| --- | --- | --- |
| Native CLI and headless | `dsh` native profile | 构建 CLI E2E、profile smoke 和无 key 原生测试已通过。 |
| Native Web client | `native.html` 与原生 Web boot | Web 生产 smoke 和 CI 构建已通过。 |
| Native Desktop | Source Desktop 启动器 | Windows source 启动已通过；安装器打包等待具备 Spectre 库的 MSBuild 输入。 |
| Native packed consumer | 无 Cordis 包安装 | 打包消费者测试已通过。 |
| Legacy Cordis profiles | 显式可选兼容依赖 | 仅通过文档化兼容入口和已审查矩阵支持。 |
| Cross-platform Desktop installers | 本地 Windows x64 unsigned；签名发布目标在其发布环境中执行 | 本地 Windows 打包被缺少 Spectre 库阻塞；macOS 和 Windows 签名声明需要对应发布环境。 |

## Alternatives considered

**把 source 启动声明为签名安装器：** Source Electron 启动可以证明原生 Desktop 路径，但不能证明安装器签名或缺失的 Windows 构建前置条件。

**在交付时删除全部兼容例外：** 五条边仍由旧 owner 消费；未迁移消费者就删除声明会隐藏真实依赖。

## Consequences

仓库可以选择原生默认装配，而不让 Cordis 进入原生产依赖闭包；旧消费者保留显式兼容路径。剩余五条 runtime-layer 例外是由旧消费者拥有的、仍在使用的具名 manifest 边；它们不作为原生依赖，并继续接受 stale-exception 校验。

验收记录不声称兼容所有 DSH 插件、不声称本 Windows 主机已经产出签名安装器，也不声称未执行的平台结果。未来删除一条兼容边时必须删除对应的精确例外，并保持 stale-exception 负向测试通过。
