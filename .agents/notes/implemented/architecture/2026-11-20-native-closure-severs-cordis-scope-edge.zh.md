# Agent Note: Native CLI 闭包停在 Cordis scope 边上

Status: implemented

[English](2026-11-20-native-closure-severs-cordis-scope-edge.md) | 中文

## Problem

`verify-runtime-closure --target native-cli` 只剩一条诊断：`@redspark/rsh -> @redspark/rsh-scope -> required Cordis peer @redspark/cordis`。这条边看起来像缺少 Native scope 原语，因为 `rsh-scope` 是所有 Cordis 注册表使用的注册与 scoped-dispatch 原语。

链路完全属于兼容面：`rsh-native-persona` -> `rsh-persona` ->（必需 peer）`rsh-system-prompt` ->（必需 peer）`rsh-scope` ->（必需 peer）`@redspark/cordis`。`rsh-persona` 的 Native 入口只导入 `@redspark/rsh-system-prompt/sections`，那是两个常量；`rsh-system-prompt` 已把该子路径作为无 Cordis 导出登记在 `nativeSafeSourceSubpaths`。`rsh-client-file-upload` 以同样方式触达 `rsh-scope`：它的 Cordis 入口导入 `scopeOf`，而 `./native` 入口安装后台 worker。

## Decision

不新增 Native 原语。`@redspark/rsh-native-runtime` 已有 `NativeScope`，且没有任何 native 入口闭包导入 `@redspark/rsh-scope`；再写一份实现不会有消费者。

`rsh-system-prompt` 与 `rsh-client-file-upload` 把 `@redspark/rsh-scope` 标为可选 peer，登记进 `nativeCompatibilityOnlyPeers`，并把该 Client 包加入 `OPTIONAL_NATIVE_HOST_PEERS`，让已发布依赖策略接受这个可选 peer。`@redspark/rsh-scope` 退出 CLI manifest，交付的启动器不再安装 Cordis scope 原语。

## Consequences

`verify-runtime-closure --target native-cli` 通过：13 个 profile 模板与 274 个工作区包构成闭合、无 Cordis 的依赖图。Python runtime 闭包与 Cordis 配置门禁不变。

`rsh-scope` 留在工作区并保留必需的 Cordis peer。它仍可从兼容树触达，那里的注册表仍依赖它的 scope 标签与 dispatch 过滤行为。只有兼容树退役时它才离开产品。

## Alternatives considered

**新建 Native scope 原语。** 否决：`NativeScope` 已为 Native 注册表提供可见性作用域，复制一套 Cordis 形状的替代品只为满足一条无人求值的依赖边。

**把 `rsh-scope` 自己的 Cordis peer 标为可选。** 否决：`rsh-scope` 在模块作用域构造 Cordis 上下文并读取 `CordisContext.filter`；它的根就是 Cordis 原语。

**通过删除 `rsh-scope` 把它移出 CLI。** 否决：兼容注册表仍导入它，而兼容树不在本次改动范围内。

## Verification

- `pnpm run verify-runtime-closure:native-cli` 以 274 个包通过。
- `pnpm run verify-runtime-closure`（Python runtime）以 149 个包通过。
- `pnpm run verify-native-dependencies`、`verify-optional-dependency-imports` 与 `constraints` 通过。
- `pnpm run verify-cordis-config` 在 132 个配置文件中通过。
- `pnpm run typecheck` 与 `pnpm run lint` 通过。
