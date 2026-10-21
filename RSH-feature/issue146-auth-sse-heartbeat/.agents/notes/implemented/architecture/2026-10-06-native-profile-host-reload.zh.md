# Agent Note: Native profile Host reload

[English](2026-10-06-native-profile-host-reload.md) | 中文

## Problem

随附的 `native-web` profile 声明了实时配置重载，但运行中的 CLI 必须在所选应用配置变化时保留 Native Host 的所有权。重载整个 Host 会丢弃未变的安装身份；若把旧应用运行因中止而返回误判为进程结束，新代际便无法继续服务。

## Decision

CLI 监视当前 profile 的 `rsh.profile.json`，以及且仅监视通过 `--patch` 显式传入的 JSON 文件。它会先加载并解析候选项，再修改正在运行的 Host。如果 scope 祖先关系、提供方和配置都未改变，loader 会复用现有 scope 与安装请求对象，使 `NativeHost.replace` 保留这些 owner。CLI 串行执行重载，并在安装 watcher 后立即重新对账一次，从而观察启动期间发生的文件变化。

格式错误或无法解析的候选会被报告并丢弃，当前运行图继续工作。成功替换会排空被中断的旧应用运行；随后 CLI 调用当前代际发布的应用。Host 激活或清理失败以及 watcher 失败都会终止进程，不会重建已经释放的 owner。关闭时先关闭 watcher、停止 Host 以中断正在运行的应用，再等待排队中的重载和 Host 完成 teardown。

只有与 invocation signal 的 abort reason 完全相同的拒绝才会被视为替换取消。若 Host 正在变更安装、拒绝发生在应用回调之前，CLI 会等待重载；独立的应用拒绝即使与候选预检重叠，也会保留原错误并终止进程。

`native-headless`、`native-sdk`、`native-acp` 和 `native-tui` profile 仍只在启动时加载。Host profile 重载不监视包源码或重建 Web Client 资源，也不提供 Cordis 插件 HMR。Client 资源重载单独记录在 [Native Web Connection and Client reload ownership](2026-10-05-native-web-connection-and-reload-ownership.zh.md)。

## Alternatives considered

**每次编辑都重建 Host：**不采用，因为这会不必要地释放未变提供方及其持有的状态；`NativeHost.replace` 已能在调用方保留请求身份时保留 owner。

**把旧应用因中止而返回视为进程正常退出：**不采用，因为 `NativeHost.replace` 会在把应用交给新代际时中止旧调用；CLI 必须启动新代际发布的应用。

**把重载期间发生的所有拒绝都视为替换取消：**不采用，因为候选预检可能与独立应用故障重叠；CLI 只重试 invocation 自身的 abort reason，或 Host 在应用回调开始前拒绝 admission 的情况。

**替换失败后恢复旧运行图：**不采用，因为激活或清理失败会终止 Host，已释放的 owner 不能安全地重新激活。

**用 Client 资源重载或 Cordis patch 重载处理 native Host 配置：**不采用，因为这些机制监视不同文件，并更新不同的运行时 owner。

## Consequences

格式错误的 profile 数据不会打断当前应用。成功变更会保留未受影响的 native 提供方，并且只在 Host 校验并激活候选后替换应用代际。包源码变更仍需重启进程；独立的 Web Client 资源 watcher 继续负责重建浏览器 bundle。
