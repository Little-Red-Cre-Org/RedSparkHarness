# Agent Note: Cordis cleanup keeps the legacy writers and three packages

Status: proposed

[English](2026-11-15-cordis-cleanup-keeps-legacy-writers.md) | 中文

> **2026-11-21 更新。** 阶段 A 在没有保留 `--from-default-profile` 路径的情况下关闭：`dsh` 不再启动 Cordis manifest，也没有任何快照或 CLI 测试创建 `legacy-headless`、`legacy-sdk` 或 `legacy-acp`。下文对桌面端与 Web 的保留仍然成立。见[仅面向 Cordis 的检查跟随 Native 启动](../../implemented/bug-fix/2026-11-21-cordis-only-gates-follow-the-native-boot.zh.md)。

## Problem

[按实测基线的五个阶段退休 Cordis](2026-11-12-cordis-retirement-five-phases.zh.md) 仍是删除路线，但它有三条近期指令在当前树上不安全。它把 `@redspark/rsh-storage-sqlite`、`@redspark/rsh-experimental-inspector` 和 `@redspark/rsh-experimental-agent-team-web-profile` 当成可删，理由只是没有别的 manifest 依赖它们。它也不能靠拒绝每一个新建的自定义 legacy profile 来结束阶段 A：剩下的 Cordis 回放和 CLI 测试会用 `--from-default-profile` 创建 `legacy-headless`、`legacy-sdk` 和 `legacy-acp`。桌面端仍会写出 legacy manifest，所以在 Web 迁移存在之前拆掉这个写入者会让桌面应用无处可启动。

## Proposal

保持五个阶段的顺序。这个决定不删除 Cordis、`rsh/Core/vendor`，也不删除 Core 与 Engine 里的 `Service` 类。2026-11-15 的审核只规定阶段 C 之前可以做什么。

### 留下的部分

- 新建的桌面 profile 和未修改的 legacy 起始 profile 通过 `createNativeDesktopProfile` 写入 `runtime: 'native'`。显式的 `runtime: 'legacy'` profile 和自定义 Cordis profile 在兼容宿主存在时仍可启动。`profile: web` 的快照，以及继承 `TypertRemoteService` 的生产类，都留到单独的界面迁移。那次迁移必须先替换远程方法注册，阶段 C 才能结束。
- 三个包里留下两个。`@redspark/rsh-experimental-inspector` 被排除在 `dsh` 发布族之外，但仍有自己的测试。`@redspark/rsh-storage-sqlite` 仍是一个可选的存储后端；它的 Native 安装器记录在 [Native 能力 owner](../../implemented/architecture/2026-11-16-native-capability-gaps.zh.md)，与该后端共用实现，并且不删除这个包。[还有什么依赖 Cordis](2026-11-10-what-still-depends-on-cordis.zh.md) 已经把这种情况和「没有任何东西可以选用的包」分开。Agent Teams Web profile 不再属于这一类：[Agent Teams 退役其 Cordis 面](../../implemented/architecture/2026-11-18-agent-teams-retires-its-cordis-surface.zh.md) 在 Team 服务只提供 Native 实现后，把它与另外两个组合包一起删除。
- `initProfile`（`rsh/Compatibility/DSH/boot/app-boot/src/profile.ts`）仍写入 `dsh.profile.bundles` 和 `patchReload`。bundle 列表选择 legacy 执行。自定义名字仍通过 `--from-default-profile` 初始化，已有的 legacy 目录仍能启动。已发布的名字仍以 Native 启动。`sdk-minimal` 继续被拒绝。[legacy Cordis 运行时还留着什么](2026-11-06-legacy-runtime-retirement.zh.md) 仍然禁止在活动 home 把 `web` 或 `desktop` 解析为 legacy 时修改 `initProfile`。

### 重新测量的数字

263 个 manifest 在 `dependencies`、`optionalDependencies`、`peerDependencies` 或 `devDependencies` 里声明 `@redspark/cordis`。每个具体的 `exports` 子路径和每个 `bin` 入口都从 `lib/` 或 `lib/types/` 映射到一个 `src` 文件。`./src/*`、`./package.json` 和 YAML 导出不是入口。从每个映射到的文件跟踪静态相对 import 和 `@redspark/*` import。走到 `@redspark/cordis`、`@redspark/cordis-*`、`@cordisjs/*` 或 `cordis` 就算到达 Cordis。只存在于 `lib/` 的生成 `./typert` 和 `./remote` 文件没有映射。Core 和 Engine 在 `rsh/Core/vendor`、测试和夹具之外仍有 23 个 `class … extends Service`。

| 检查 | 数量 |
|---|---|
| 声明 `@redspark/cordis` 的 manifest | 263 |
| `rsh/` 下、`node_modules`、`lib` 和 `dist` 之外，包含 `@redspark/cordis` 的 `.ts` 与 `.tsx` 文件 | 1279 |
| `rsh/Core` 与 `rsh/Engine` 中、vendor、测试和夹具之外的 `class … extends Service` | 23 |
| `profile: legacy-headless` 的 `snapshot.yml` | 6 |
| `profile: legacy-sdk` 的 `snapshot.yml` | 9 |
| `profile: legacy-acp` 的 `snapshot.yml` | 8 |
| `profile: web` 的 `snapshot.yml` | 34 |
| `profile: headless` 的 `snapshot.yml` | 80 |
| 入口遍历会到达 Cordis 的包（`cordis-only`） | 75 |
| 入口里既有到达 Cordis 的、也有不到达的包（`mixed`） | 176 |
| 已映射入口的遍历都不到达 Cordis 的包（`native-clean`） | 10 |
| 没有映射到代码入口的包（`unresolved`） | 2 |

这 75 个 `cordis-only` 包里，21 个在 `rsh/Compatibility/DSH`，12 个在 `rsh/Programs/Web`，7 个在 `rsh/Modules/Official`，6 个在 `rsh/Core/vendor`。`native-clean` 只表示每个已映射入口都没有走到 Cordis。它不表示这条 manifest 声明没有人用。对 `.ts`、`.tsx`、`.mts`、`.mjs`、`.js`、`.yml` 和 `.yaml` 做文本搜索，排除 `package.json`、`node_modules`、`lib` 和 `dist` 之后，263 个包里有 258 个提到了这个名字。`@redspark/rsh-native-jobs-controller` 不在这组里：它是 Native 包，并且不声明 Cordis。[Native 回放通过后 Cordis 回放停止](../../implemented/testing/2026-11-14-cordis-replay-stops-when-native-passes.zh.md) 记录了为什么那 6 个 `legacy-headless` 目录、剩下的 `legacy-sdk` 目录和 `legacy-acp` 留下。2026-11-12 的 84、169 和 10 不是现在的分级。

### 仍然声明的部分

`@redspark/rsh-native-jobs-controller` 在 Native 名单上，并且不声明 `@redspark/cordis`。五个包仍然只在 `package.json` 里提到 `@redspark/cordis`。它们不是一次安全修改。

- `@redspark/rsh-compat-fs-local`、`@redspark/rsh-compat-fs-policy`、`@redspark/rsh-compat-fs-sandbox` 和 `@redspark/rsh-llm-mock-server` 是 `nativePackageDirectories` 之外的 `@redspark/rsh-*` 库。`rsh/Scripts/check-workspace-constraints.ts` 里的 `checkCordisPeerPolicy` 要求 `@redspark/cordis` 同时是 peer dependency 和 dev dependency。删掉这条声明会让那项检查失败。`@redspark/rsh-native-jobs-controller` 已在 `nativePackageDirectories` 里，所以这条规则改为禁止它声明 Cordis。
- `dsh-python-runtime-closure`（`rsh/Programs/SDK/python/sdk-runtime`）是 Python wheel 的部署根。它还依赖 `@redspark/rsh-cordis-host-runner` 和 `@redspark/rsh-tool-cordis`。去掉 `@redspark/cordis` 会改变这个 wheel。[按实测基线的五个阶段退休 Cordis](2026-11-12-cordis-retirement-five-phases.zh.md) 把这个 closure 留作反向检查表。
- `rsh/Core/vendor` 留下。Core 和 Engine 的 23 个 `Service` 类留下。`rsh/Programs/Desktop/src/project-manager.ts` 留下。三个保留包留下。`--from-default-profile` 留下，因为剩下的回放和 CLI 测试仍会创建 `legacy-headless`、`legacy-sdk` 和 `legacy-acp`。

### 这个决定不开始的工作

阶段 C 和阶段 E 不开始。只要还有包 import `@redspark/cordis`，`rsh/Core/vendor` 就留下。两个托管入口 `rsh/Core/runtime-diagnostics/cordis-bridge` 和 `rsh/Engine/preset/native-persona` 跟它一起留下。不要移植 `cordis_define`、`cordis_undefine` 或 `cordis_inspect_query`。不要在 `@redspark/rsh-tool-cordis` 之前删掉它们的三个场景。

## Alternatives considered

**现在就拒绝每一个新建的自定义 legacy profile。** 否决。快照运行器和 CLI 端到端测试每次运行都会用 `--from-default-profile` 创建 `legacy-headless`、`legacy-sdk` 和 `legacy-acp`。拒绝这一类名字会在已记录的阻塞移走之前删掉剩下的 Cordis 证据。

**删掉没有别的 manifest 依赖的包。** 否决。缺少 manifest 依赖不等于没有这项能力。存储后端可以被选用，inspector 包仍有测试。Agent Teams Web profile 后来被删除是因为另一条理由：它的运行时面已不存在，而不是因为没有依赖。

**在显式 legacy profile 仍可启动时开始阶段 C。** 否决。那些 profile 启动的就是阶段 C 要删的 `Service` 类。先删这些类会让仍选择 Cordis 的桌面 profile 无法启动。

**删掉每一个没有任何文件写到名字的声明。** 对留下来的包否决。其中 4 个是 `checkCordisPeerPolicy` 要求的。`dsh-python-runtime-closure` 把这条依赖放进 Python wheel。`@redspark/rsh-native-jobs-controller` 是例外：它的源码走不到 Cordis，而且 Native 名单禁止这条声明。

## Acceptance criteria

- [按实测基线的五个阶段退休 Cordis](2026-11-12-cordis-retirement-five-phases.zh.md) 不再说这三个包现在可以删，并且它的 84 / 169 / 10 分级表被标明是 2026-11-12 的测量。
- `initProfile` 写明新 manifest 会保存 `dsh.profile.bundles`，并且不会设置 `runtime: 'native'`。
- 本决策不删除任何包目录。新建的桌面 profile 仍写出 `runtime: 'native'`，显式 legacy profile 不会被改写。
- `@redspark/rsh-native-jobs-controller` 不声明 `@redspark/cordis`。其余没有别处提到的包继续声明 Cordis。

## Risks

- 出口遍历可以把一个包标成 `native-clean`，而 `checkCordisPeerPolicy` 仍然要求 Cordis peer。只按出口分级去删，会让工作区检查失败，或拆掉一个 legacy 插件宿主。
- 人仍可以用 `--from-default-profile` 创建 Cordis profile。这是留给剩余回放和测试的路径，不是静默改写已有目录。
