# Agent Note: 交付的 CLI 包图不再触达 Cordis

Status: implemented

[English](2026-11-19-cli-package-graph-drops-cordis.md) | 中文

## Problem

`dsh` 只启动 Native profile，但它的 manifest 仍在描述一个它已不再启动的 Cordis 应用。`@redspark/cordis`、`cordis-plugin-loader` 与七个 `rsh/Compatibility/DSH/bundle` 层留在 `dependencies` 或 `optionalDependencies` 中，于是 `pnpm pack` 产出的 CLI 仍携带另一套应用的组合。profile 模板新增的 Native profile 行却声明为可选，`verify-runtime-closure --target native-cli` 因此把它们报告为缺失。

该门禁就是 Cordis 删除的判据：它遍历 CLI manifest 的必需闭包并拒绝每个 Cordis 包，所以通过即证明交付的启动器不触达任何 Cordis 运行时。改动前它报告十九条诊断，混杂了过时的 Cordis 声明与 Native profile 真正挂载的行。

## Decision

CLI manifest 只描述 Native 应用。`@redspark/cordis` 与 `cordis-plugin-loader` 退出两个依赖段；bundle 层退出 `optionalDependencies`；`@redspark/rsh-app-boot` 移到 `devDependencies`，因为只有 `dsh-badge` 的 Cordis 快照夹具仍经它启动。

Native profile 行挂载的每个包都成为硬 `dependencies` 条目：`rsh-request-context`、`rsh-session-telemetry`、`rsh-session-telemetry-otel`、`rsh-skill`、`rsh-skill-filesystem`、`rsh-terminal`、`rsh-terminal-bash`、`rsh-tool-bash-persistent`、`rsh-tool-pwsh-persistent` 与 `rsh-tool-skill`。触达这些行后，`rsh-http-routes`、`rsh-invariants`、`rsh-scope` 与 `rsh-system-prompt` 也成为必需项。

同时导出两个面的浏览器 Client 包把 `@redspark/cordis` 声明为可选 peer。`rsh-client-resources`、`rsh-client-ui-brand-official`、`rsh-client-ui-input-trigger`、`rsh-client-ui-message-feedback`、`rsh-client-ui-model-selection`、`rsh-client-ui-open-in-app`、`rsh-client-ui-permission-presets`、`rsh-client-ui-pet`、`rsh-client-ui-plan`、`rsh-client-ui-reference` 与 `rsh-client-ui-schedule` 在 Native profile 中经 `./native` 导出挂载；它们的 Cordis 入口最多只导入 `Context` 类型，因此该 peer 不是打包依赖。`rsh-host-open-in-app` 以同样方式对待 `@redspark/cordis` 与 `@redspark/rsh-http-routes-cordis`。

这十二个包进入 `mixedNativeEntryDirectories`，因为它们各自交付一个 Cordis 入口与一个挂载同一实现的 `./native` 安装器。归类后暴露出 Native 源读取的四条无 Cordis 子路径：`rsh-file-reference/grammar` 与 `/types`、`rsh-session-reference/types`、`rsh-schedule/client` 以及 `rsh-host-open-in-app/shared`。它们现在都记录在 `nativeSafeSourceSubpaths` 中；每条只承载类型或纯格式化，且都不导入 Cordis。

`rsh-tool-skill` 把 `rsh-agent` 与 `rsh-tools` 声明为可选 peer，并把这二者记录在 `nativeCompatibilityOnlyPeers`。它的 `./native` 入口经 `rsh-native-tools` 构造注册；这两个 peer 只被 Cordis 入口值导入，因此 Native 安装永远不需要它们。

## Consequences

`verify-runtime-closure --target native-cli` 从十九条诊断降到一条：

```
@redspark/rsh -> @redspark/rsh-scope -> required Cordis peer @redspark/cordis
```

剩下的一条属于 Cordis 服务面，而不是打包漂移。`rsh-scope` 在模块作用域用 `CordisContext` 铸造上下文并读取 `CordisContext.filter`，因此不能把该 peer 声明为可选；它经 `native-persona` → `rsh-persona` → `rsh-system-prompt` → `rsh-scope` 进入 CLI。关闭它需要一个不建立在 Cordis `Context` 之上的 Native scope 原语，属于服务骨架阶段。

`rsh/Compatibility/DSH` 保留。它的 bundle 仍是 Desktop 兼容装配、浏览器兼容应用与 WebWorker 预览的组合来源，删除该树等于退役这三个界面，而不是清理死代码。

## Alternatives considered

**把 `rsh-scope` 的 peer 声明为可选。** 否决：`rsh-scope` 本身就是 scope 原语；它的模块作用域构造 Cordis 上下文并读取 `CordisContext.filter`，这不是可选 peer 能描述的兼容入口细节。

**把 `rsh-agent` 与 `rsh-tools` 声明为可选但不做记录。** 否决：`verify-optional-dependency-imports` 拒绝被任何 Cordis-free 闭包之外源码在模块作用域加载的可选 peer，因此二者都记录进 `nativeCompatibilityOnlyPeers`，说明只有 `tool-skill` 的 Cordis 入口导入它们。

**把 `rsh-agent` 与 `rsh-tools` 作为 CLI 依赖交付。** 否决：两者都声明必需的 `@redspark/cordis` peer，Native 闭包会再次触达 Cordis；只有它们的 Cordis 半边不复存在后，这样的打包才诚实。

**在本次改动中删除 `rsh/Compatibility/DSH`。** 否决：Desktop 兼容装配仍解析 `@redspark/rsh-desktop-host-compatibility`，`rsh/Tests/test-support/client-runtime` 仍组合 `rsh-base` 与 `rsh-web-app` 的 roster。移除它是对 Desktop 旧版 profile、兼容 Web bundle 与 WebWorker 预览的产品退役，不是打包改动。

## Verification

- `pnpm run verify-runtime-closure:native-cli` 恰好报告上面那条 `rsh-scope` 诊断。
- `pnpm run verify-cordis-config` 在 132 个配置文件中通过。
- `pnpm run verify-optional-dependency-imports` 通过。
- `pnpm run verify-native-dependencies` 与 `pnpm run constraints` 通过。
- `pnpm run typecheck` 通过。
