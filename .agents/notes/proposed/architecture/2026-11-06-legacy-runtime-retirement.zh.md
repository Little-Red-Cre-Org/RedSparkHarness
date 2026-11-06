# Agent Note: legacy Cordis 运行时仍握着什么，以及随之退场的是什么

Status: proposed

[English](2026-11-06-legacy-runtime-retirement.md) | 中文

## Problem

已发布的每条 `dsh` 命令——`web`、`headless`、`sdk`、`acp`、`rsh`——现在都先写 Native profile，再经 Native 启动路径拉起。legacy Cordis 路径仍可达，而且是由**用户数据**而非开关决定的：`resolveRshProfileExecution` 读 profile 自己的 `package.json`，对三种 manifest 形态返回 `legacy`。这些 profile 仍然能用，所以在该人群确认为空之前，legacy 侧任何东西都不能删。

本篇记录本分支决定保留什么、退场需要改哪些调用点、以及退场后会变成不可达的是什么。它不删除任何东西。

## Proposal

### 谁还在跑 legacy，为什么

`resolveRshProfileDirectoryExecution`（`rsh/Core/util/home-paths/src/profile-runtime.ts`）在以下情况返回 `legacy`：

| manifest 状态 | 行 | 谁会产生 |
|---|---|---|
| 没有 `package.json` | :31 | 手建的 profile 目录 |
| `dsh.profile.runtime: 'legacy'` | :46 | 显式退出 |
| `dsh.profile.bundles: [...]` | :39 | Native 之前的 profile 格式 |
| 既无 runtime 也无 bundles | :46 | 响亮报错拒绝，不静默 |

缺 manifest 在实践中**不**等于未初始化 profile：`bin.ts:31-33` 对每次 `profile` 与 `dump-config` 调用都执行 `ensureShippedNativeProfile`，它会写出声明 `runtime: 'native'` 的 manifest。因此五个标准名在首次使用时都收敛到 Native。legacy 人群因此是：非标准名且无 manifest 的 profile，以及任何声明 `bundles` 或 `runtime: 'legacy'` 的 manifest。

`bundles` 形态没有已发布的产生者。`rsh/Compatibility/DSH/bundle/*` 是 bundle **包**（`cordis.patch.yml` 加 `lib/`），不是 profile manifest；仓库里真正声明 `bundles` 的 manifest 只有测试夹具（`rsh/Programs/CLI/tests/built-bin.e2e.ts`）。野外的 `bundles` profile 来自更早的 `dsh`、legacy CLI 下的 `dsh plugin`，或手写。

### 退场要改的调用点

`bin.ts` 有三处 `profileRuntime(...) === 'native'` 分支，各自的 legacy 臂都要去掉：

| 模式 | legacy 臂 | 取代它的是什么 |
|---|---|---|
| `profile` (:49-58) | `requireCompatibilityRuntime()` 后 `runProfile()`（来自 `profile-boot.ts`） | 拒绝并指向 `rsh/Docs/native-config-migration.md` |
| `plugin` (:67-69) | `runPlugin()`（来自 `plugin.ts`） | :65 已有的 Native 拒绝本就覆盖 |
| `dump-config` (:83-90) | `runDumpConfig()`（来自 `dump-config.ts`） | :76-81 的 Native 分支本就作答 |

`plugin.ts` 与 `dump-config.ts` 都从 `profile-boot.ts` 导入，但只为 Native 也需要的部分：`INSTALL_ANCHOR`（CLI 包根）与 `prepareProfile`/`homePatchPath`/`PROFILE_ROOT_FILENAME`。退场是**拆分** `profile-boot.ts` 而不是删除它：Cordis 的 `runProfile` 组装与 `healProfilesModuleFallback` 走掉，路径与锚点助手留下或迁走。

### 会变成不可达的

- `compatibility-runtime.ts`——唯一调用者就是那三个 legacy 臂。
- `profile-boot.ts` 的 Cordis 半边（`composeProfile`、`runProfile`、loader 管道）。
- **`bundles` 语法本身**，这正是要点：`resolveRshProfileDirectoryExecution` 的 `bundles` 分支及其 `patchReload` 校验，只为服务 Native 之前的 profile 而存在。
- `optionalDependencies` 里那些只有 legacy 组装才消费的 `@redspark/rsh-*app`/`base` bundle。

删除这些包是另一个更大的决定：CLI 把它们声明为可选依赖，正是为了让 legacy profile 能解析到；Native profile 改为解析自己的包集合。

## Alternatives considered

**见到 profile 就直接转成 Native。** 作为退场步骤否决：把用户的 `package.json` 从 `bundles` 改写成 `runtime: 'native'`，等于用一份 Native 组装静默替换 Cordis 组装，而两者并不含相同的插件。报告差异的迁移命令是另一份提案。

**现在就删 legacy 包，让旧 profile 启动失败。** 否决：这会把一个可用的 profile 变成没有预警的启动错误。[fail-loud 规则](../../../../AGENTS.md)只在替代方案是静默损坏时才允许这种处理，而这里 profile 仍然可用。

**把 legacy 路径永久留在同一个开关后面。** 否决：`compatibility-runtime.ts` 的存在是为了给出唯一一条明确的安装补救；若该路径永久化，它也会永久钉住 Cordis bundle 集合、`bundles` 语法，以及每个只被 bundle 解析的可选依赖。

## Acceptance criteria

只有在以下全部成立后才能开始退场：

1. 没有任何已发布的 `dsh` 版本还会写出 `bundles` manifest。用最近几个版本的 `PROFILE_TEMPLATES` 与 `initProfile` 历史核实。
2. 遥测或用户报告确认没有活跃 profile 解析为 `legacy`。本地检查是在真实 home 下对各个 profile 跑 `profileRuntime(name)`。
3. `rsh/Docs/native-config-migration.md` 已写明旧 profile 必须变成什么，包括插件集合的差异。

## Risks

- 由旧 `dsh` 创建、此后从未再运行过的 profile 会失去可用性。缓解手段是迁移文档加一条点名 profile 与文件的拒绝；静默改写不是。
- 拆分 `profile-boot.ts` 会触及 CLI 仅剩的 Cordis 边，因此拆分必须先于任何包删除落地，而删除必须是它自己的 PR。
