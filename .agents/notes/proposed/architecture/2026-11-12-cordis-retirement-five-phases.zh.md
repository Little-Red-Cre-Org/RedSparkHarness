# Agent Note: 按实测基线的五个阶段退休 Cordis

Status: proposed

[English](2026-11-12-cordis-retirement-five-phases.md) | 中文

## Problem

`rsh/Docs/architecture.md` 仍把这个 harness 描述成全插件式的 Cordis harness，而这字面上仍然成立。Native profile 通过 `NativeContext` 启动插件、按能力键读取依赖，但那些能力键背后的服务由 `class X extends Service` 子类实现，其作用域、生命周期与事件派发都归 Cordis。2026-11-12 的基线把推论说得很清楚：Native 跑在 Cordis 类之上，所以不先脱掉这层骨架，Cordis 就删不掉。

在给任何一个阶段排期之前，基线的数字都在 `7419c1be0c` 这棵树上重新测过，因为每个阶段的大小都由其中一个数字决定。有四处说法变化大到足以改动计划：仅类型引用的规模是所报数字的三倍，Core+Engine 的骨架是 23 个类而不是 15 个，四个「可立即删」的包里有一个是 Python wheel 的部署根，十一个场景实际是 246 个录制用例，其中 207 个仍在 legacy 或 web profile 上回放。

本 Note 记录实测基线、它支持的五个阶段路线，以及每个阶段必须产出的出口证据。它不改任何代码。

## Proposal

五个串行阶段：A 封住 legacy 出口，B 补齐 Native 能力，C 脱掉 Cordis 骨架，D 排空剩余引用，E 删除包。每个阶段从新抓的 `origin/main` 切出、各自单独成 PR，每个阶段的出口就是下一阶段可用的输入。

### 重新实测改动了什么

| 基线说法 | 2026-11-12 实测 | 对路线的影响 |
|---|---|---|
| 377 个包中有 252 个引用 `@redspark/cordis` | 360 个受跟踪的 `rsh/` manifest 中有 263 个声明它；1280 个 `.ts` 文件 import 它 | D 比计划的更宽 |
| 值级 110、仅类型 142 | 值级 824 个文件、仅类型 456 个文件 | 仅类型的清理是 D 里更大的一半 |
| 48 包、51 类、Core+Engine 内 15 个 | 全仓 70 个类；Core+Engine 内 23 个，另有 `Core/vendor` 里 2 个 | C 覆盖的类比预算多八个 |
| 六大核心库都是 `extends Service` | 确认；它们都没有外部子类，且 23 个里有 15 个已经带 Native Provider | C 的代价在改消费者，不在写 Provider |
| 四个零引用包可立即删 | 三个；`dsh-python-runtime-closure` 是 `rsh/Scripts/build-exe-for-python-sdk.ts:23` 指名的部署根 | E1 缩小；部署根变成反向检查表 |
| 十一个场景各需一个 `<scene>-native.snapshot.ts` | 246 个用例；39 个在 native profile 上回放，207 个在 legacy 或 web | B 要按用例计数，不按场景 |

### 覆盖率分三级

263 个声明包中的每一个都落进一级：把每个 manifest 的 `exports` 子路径解析到 `src` 入口，再从那里跟踪相对 import 与 `@redspark/*` import：

| 级别 | 包数 | 删 Cordis 对它意味着什么 |
|---|---|---|
| `cordis-only` | 84 | 没有任何入口能到达无 Cordis 的源码：重写该包或删掉它 |
| `mixed` | 169 | 有一个入口（通常是 `./native`）已经无 Cordis，其余是 legacy 半边 |
| `native-clean` | 10 | 声明了 peer 却没有任何东西到达它：这条声明是陈旧的 |

### Native 半边已经没有 Cordis

Native 侧没有任何文件读取 Cordis 服务名：没有 `native.ts`、也没有任何 `src/native-*` 文件调用 `ctx.sessions`、`ctx.tools` 或别的 `ctx.<service>`。Native 入口通过能力键解析依赖，全树共提供 103 个不同的能力键。有两个包是故意从 Native 入口托管 Cordis 插件的——`rsh/Core/runtime-diagnostics/cordis-bridge` 与 `rsh/Engine/preset/native-persona`——两者都记在 `rsh/Scripts/native-package-policy.ts` 里。

这就给阶段 C 划了边界：它不是 165 个入口改写，而是逐个删掉 legacy 半边，这部分集中在 1280 个文件、39.9 万行里。`rsh/Modules/Official`（9.4 万行）与 `rsh/Programs/Web`（8.9 万行）占了近一半。

### 阶段 A —— 封住 legacy 出口

- `dsh.nativeProfileTemplates` 里的 13 个名字都以 Native 启动。`sdk-minimal` 是唯一仍走 legacy 的已发布名字，也是唯一把 `rsh-terminal` 与两个 persistent shell 组合在一起的 profile。
- 定了 `sdk-minimal` 就定了 A：要么给 `native-sdk` 补一个 shell——它组合了 30 个插件却没有 shell——要么拒绝这个名字并记录它的能力去了哪里。
- `bin.ts` 里的三条 legacy 分支（`profile`、`plugin`、`dump-config`）在 `2026-11-06-legacy-runtime-retirement.md` 之后退休，由那份 Note 记录什么会变得不可达。
- 出口：每个已发布名字都以 Native 启动，需要 legacy 的自定义名字被按名字拒绝，且 `initProfile` 不再写 legacy manifest。

### 阶段 B —— 补齐 Native 能力

- 实测还剩三个能力缺口：`tool-bash-persistent` 与 `tool-pwsh-persistent` 完全没有 `dsh` 块，`code-runtime-python` 没有 Native 入口，`NativeExternalSubagentOutcome`（`rsh/Engine/subagent/native-subagent/src/external-driver.ts:315`）有 `output`、`structured` 和 `stopReason` 却没有 diagnostic。
- 可组装的 ACP child 不再是缺口：`rsh-acp-child` 已经提供 `externalSubagentDriver`，所以 B 要做的是两个 persistent shell、一个 Native Python code runtime、一个可选的 diagnostic 字段，以及把它们挂起来的 profile。
- 207 个 legacy 与 web 用例按场景分批迁到 Native profile，每批把用例差异作为自己的证据。
- 出口：没有任何用例在没有记录阻塞原因的情况下仍通过 `legacy-headless`、`legacy-sdk` 或 `legacy-acp` 回放，且 `native-sdk` 覆盖 `sdk-minimal` 原本覆盖的能力。

### 阶段 C —— 脱掉 Cordis 骨架

- 23 个类分成 15 与 8 两组：十五个已经有对应能力键下的 Native Provider，它们那一批只需要删类并改写消费者；八个要先写出 Provider。
- 每一批都做同样三处改动：把 Service Definition 发布成能力键，在 `NativeContributions` 里注册 Native Provider，把每个消费者从 `ctx.<name>` 改成 `context.require('<key>')`。
- `TypertRemoteService` 是例外，归 Web：有 23 个类 extends 它，其中一半在 `rsh/Programs/Web`，而它的 Remote 方法注册没有对应的能力键可以替代。

| 批次 | 类数 | 已提供 | 要改写的消费者站点 |
|---|---|---|---|
| C1 session | 7 | 6 个，另有 `session-telemetry-otel` 提供 `sessionTelemetry` | 74 处 `ctx.sessions` |
| C2 llm | 2 | 1 个（`TokenMeter`） | 19 处 `ctx.llm` |
| C3 agent、tools、prompt | 5 | 2 个（`ToolResultPruner`、`CompactionEngine`） | 49 处 `ctx.tools`、39 处 `ctx.agents`、25 处 `ctx.systemPrompt` |
| C4 loop、context | 2 | 1 个（`FileReferenceService`） | 23 处 `ctx.subagents`、2 处 `ctx.agentLoop` |
| C5 Core 叶子 | 7 | 4 个 | 14 处 `ctx.jobs`、39 处 `ctx.invariants`、7 处 `ctx.storage`、5 处 `ctx.typert` |

### 阶段 D —— 排空剩余引用

- 456 个文件只为类型而 import `@redspark/cordis`。每个都要把它的声明搬到所属包或一个 `./native` 子路径下，而 25 个被 import 的名字集中在 `Context`（1153 处）与 `Service`（102 处）。
- 84 个包是 `cordis-only`，其中 35 个在 `rsh/Programs/Web`、20 个在 `rsh/Modules/Official`，所以 D 的形状跟着 E2 和 E3 走。
- 出口：`@redspark/cordis` 只被 `rsh/Core/vendor` 和那两个受许可的托管入口 import。

### 阶段 E —— 删包

- E1 现在就能做：有三个包没有任何 manifest 消费者——`rsh-storage-sqlite`、`rsh-experimental-inspector` 与 `rsh-experimental-agent-team-web-profile`——最后一个要连同 `rsh/Scripts/release/families.spec.ts:60` 一起改。
- `Core/vendor` 只能最先或最后，绝不能中间：只要还有任何一个 Cordis 包活着，vendor 的 `Service`、`Context` 与 loader 就是它的依赖。
- `dsh-python-runtime-closure` 是反向检查表。它的 workspace 依赖就是 Python wheel 要发布的集合，所以一个不在其中的包需要的理由与在其中的包不同。
- 出口：没有任何 manifest 声明 `@redspark/cordis`，且构建、类型检查、单元测试与 keyless 快照回放全部通过。

### 邻近几份 Note 各自 owns 什么

这条路线是嵌在三份提案之间的，而不是替代它们，所以每份各自保留自己的主题：

- [Legacy 运行时退休](2026-11-06-legacy-runtime-retirement.zh.md) owns 哪些 profile 形状会走到 legacy，以及它们停下时什么会变得不可达；阶段 A 消费它的结论，而不是重述一遍。
- [还有什么依赖 Cordis](2026-11-10-what-still-depends-on-cordis.zh.md) owns 逐包清单，以及那些无法回放场景背后的能力缺口；阶段 B、D、E 把它当作持续维护的分类来读，而不是另存一份。
- [Native 运行时与可选 Cordis](2026-09-22-rsh-native-runtime-and-optional-cordis.zh.md) owns 建造 Native 运行时的 P0–P6 路线；A–E 在 P5 之后开始，回答那条路线留下的删除问题。

### 阶段之间的硬依赖

- A 先于 B，B 先于 C，C 先于 D，D 先于 E。每个阶段的出口就是下一阶段可用的输入，把任何一对颠倒过来都意味着同时维护两套组合。
- E 内部：E1 独立，E6 最先或最后，E5 要显式断边而不是等级联波及到它。
- 只有 B 的快照批次与 C 的类批次可以并行；两者都从新抓的 `origin/main` 切出、各自单独成 PR。

## Alternatives considered

**先删 vendor 框架，让树先红。** 否决：今天有 263 个 manifest 依赖 vendor 的 `Service`、`Context` 与 loader，提前删只会把一棵能跑的树变成编译失败，而不会教给我们任何关于消费者面的东西。

**只按引用次数决定骨架迁移顺序。** 否决把它当作唯一排序信号：`ctx.invariants` 的 39 处看着不大，却由 38 个包自带的 `invariant.ts` 伴生文件串起来；`ctx.sessions` 以 74 处居首，而 `SessionStore` 已经有 Native Provider。批次的顺序同时权衡 Provider 的可用性与站点数。

**把 `NativeContext` 做成 Cordis 门面，只删 `Service`。** 否决：门面会让一个 Cordis `Context` 继续活着，于是 loader、fiber 树与它的拆卸顺序都会在删除之后存活下来，「没有 Cordis」这句话就是假的。

**按区域迁移——先整个 Core，再 Engine，再 Modules。** 否决：一个服务在它的最后一个消费者迁走时才能删，而消费者横跨区域。按区域排会让每一批都只做一半，并对同样的文件来回跑第二遍。

## Acceptance criteria

- 阶段 A 完成的标志：`dsh.nativeProfileTemplates` 里每个名字以及每个已发布别名都以 Native 启动，且需要 legacy 的自定义名字被拒绝、错误信息指名 `rsh/Docs/native-config-migration.md`。
- 阶段 B 完成的标志：没有任何快照用例在没有记录阻塞原因的情况下仍通过 `legacy-headless`、`legacy-sdk` 或 `legacy-acp` 回放，且 `pnpm run test:snapshot` 在无 key 时通过。
- 阶段 C 完成的标志：`class <name> extends Service` 在 `Core/vendor` 之外的 `rsh/Core` 与 `rsh/Engine` 下不再命中任何东西，且 `Core/vendor` 之外没有任何源码读取 Cordis 服务名。
- 阶段 D 完成的标志：`@redspark/cordis` 只被 `rsh/Core/vendor` 与那两个受许可的托管入口 import。
- 阶段 E 完成的标志：没有任何 manifest 声明 `@redspark/cordis`，`pnpm run build`、`pnpm run typecheck`、`pnpm run test` 与 `pnpm run test:snapshot` 全部通过，且 `rsh/Docs/architecture.md` 不再把它描述成 Cordis harness。

## Risks

- 这层骨架在拆卸路径上承重。`NativeContext.own` 与 `ctx.effect` 不共享排序保证，所以把其中一个换成另一个的批次必须带上生命周期 fixture；否则缺陷会以泄漏或重复关闭的形式在负载下出现，而不是以测试失败的形式出现。
- 删一个 legacy 半边就是删它的测试，而那是那个 Cordis Provider 唯一的行为记录。每一批要么把覆盖能力带走，要么在 PR 里记下损失。
- `TypertRemoteService` 没有 Native 后继，而它一半的子类在 Web，所以 C 在 Remote 方法这一面被设计出来之前收不了尾。
- 三级是测量结果，不是固有属性：它们是靠把 `exports` 解析到 `src` 算出来的，所以一个只导出构建后 `lib/` 路径的包会被误判，而这项测量在每个阶段之后都要重跑。
