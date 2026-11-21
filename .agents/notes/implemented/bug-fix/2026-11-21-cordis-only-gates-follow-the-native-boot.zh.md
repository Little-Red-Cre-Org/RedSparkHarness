# Agent Note：仅面向 Cordis 的检查跟随 Native 启动

Status: implemented

[English](2026-11-21-cordis-only-gates-follow-the-native-boot.md) | 中文

## 问题

`dsh` 只启动 Native profile：`rsh/Programs/CLI/src/bin.ts` 读取 `rsh.profile.json` 组合，并以 `does not exist or does not select Native execution` 拒绝 Cordis `bundles` manifest。三处检查仍在假定已退役的路径。

`rsh/Tests/benchmarks/agent-continuation/profile-continuation.worker.ts` 写出声明 `dsh.profile.bundles: ['@redspark/rsh-sdk-minimal']` 的 `bench-minimal` profile，并通过构建后的 `dsh` 启动它。CLI 会拒绝该 manifest，因此 `check:ci:bench` 的 `profile-continuation` 场景无法通过。该文件最后一次编辑早于 legacy 启动路径退役。

`rsh/Programs/SDK/python/sdk/tests/test_bundled_runtime.py` 用 `@redspark/rsh-base` 与 `@redspark/rsh-sdk-app` 构造 `legacy-sdk` profile，并断言缺失的 patch 条目会暴露出来。CLI 现在在任何 patch 被读取之前就拒绝该 profile，所以该用例要么被跳过，要么因与其断言无关的原因失败。

`rsh/Scripts/verify-runtime-closure.ts` 仍列有 `rsh/Programs/CLI/src/bin.ts` 导入 `@redspark/rsh-app-boot` 的条目，而启动器已不再存在该边。该守卫无法触发。

## 决策

退役两个以 Cordis 启动为被测对象的用例，并删除失效的守卫行。

`profile-continuation` 场景测量的是经由 `sdk-minimal` Cordis bundle 的端到端 SDK 续聊。该 bundle 是退役候选，它所需的 profile 无法启动，而 Native 替代品测量的是另一条启动路径、需要独立校准。该场景、其 worker、其合成 `LlmAdapter` 及构建条目一并删除；Native profile 启动基准是另一项测量，而不是静默改指向。

一旦 CLI 拒绝 `bundles` manifest，Python 用例就失去唯一含义。`test_bundled_runtime_boots_the_sdk_profile` 与 `test_python_sdk_applies_an_ordered_profile_patch` 继续覆盖两种载体。

## 考虑过的替代方案

**把基准改指向 Native `sdk` 模板。** 本次拒绝：合成模型是注册在 `ctx.llm` 上的 Cordis `LlmAdapter`，而 Native 模型接缝经由 `native-model-execution`。移植它需要 Native 脚本化 provider 加上新的参考机校准，那会替换被测对象而非修复它。

**保留 Python 用例并断言新的拒绝。** 拒绝：`smoke-python-runtime.py` 已覆盖该拒绝，而该用例记录的前提——legacy 载体能解析其 patch 图——已不存在。

**保留失效的守卫行。** 拒绝：永不匹配的守卫会被读作对一条树中已不存在的边的覆盖。

## 后果

`check:ci:bench` 保留三个已校准场景而非四个。`agent-continuation` 的 README 不再宣称 SDK profile 变体，其使用的 workload 常量保留，因为剩余场景共享它们。

没有任何 Cordis 包因此变得可删除：bundle、`rsh-app-boot` 与 `rsh-cmdline` 仍被 [以五个可测量阶段退役 Cordis](../../proposed/architecture/2026-11-12-cordis-retirement-five-phases.zh.md) 中描述的宿主内 Web scaffold 组合使用。

## 验证

- `pnpm run typecheck`
- `pnpm run verify-runtime-closure:native-cli`（13 个模板，274 个包）
- `npx vitest run rsh/Scripts/verify-runtime-closure.spec.ts`（9 个测试）
