# Agent Note: 还有谁依赖 Cordis

Status: proposed

[English](2026-11-10-what-still-depends-on-cordis.md) | 中文

## Problem

这次迁移的目标以删除 Cordis 收尾。能否达到取决于还有多少包依赖它、以什么方式依赖——而这个数字不在任何一个文件里。读 profile 模板的人看到六个 bundle；读包策略的人看到分类；两者都不说还有多少代码非得靠 Cordis 运行时才能跑。

在迁移分支上实测：**268 个包把 \`@redspark/cordis\` 声明为 dependency 或 peerDependency**。其中 **\`rsh/Compatibility\` 与 \`rsh/Tests\` 之外的 113 个**没有 \`dsh.native\` 入口，也就是说它们根本无法在 Native 运行时下跑。

## Proposal

现在把实测形状记录下来，让删除 Cordis 按事实规划，而不是假定它会跟着场景迁移一起完成。

这 113 个按区域分：\`Programs/Web\` 35、\`Modules/Official\` 21、\`Modules/Community\` 9、\`Engine/core\` 8、\`Engine/session\` 6、\`Core/vendor\` 6、\`Engine/context\` 4、\`Engine/subagent\` 4、\`Core/typert\` 4、\`Engine/jobs\` 3，其余散落在 \`Programs/{SDK,Desktop,CLI,ACP}\`、\`Core/{util,subprocess,storage,runtime-diagnostics}\`、\`Engine/{preset,llm,compaction}\`，各为一两个。

最大的一块是 Web 应用面，但它是**迁移到一半而不是没动过**：它 75 个包里 33 个已经有 `dsh.native` 入口，只有 35 个仍是 Cordis-only。剩下的那一半主要是兼容渲染器仍在挂载的客户端 UI。第二块是官方 Modules，其中若干旁边已经有 Native Provider——Cordis 那一半正是组合了兼容 bundle 而不是 Native bundle 时场景仍会走到的部分。

有三个场景使用只存在于 Cordis 一侧的工具——`cordis_define`、`cordis_undefine`、`cordis_inspect_query`——由 `@redspark/rsh-tool-cordis` 提供，而它是 Cordis 插件、没有 Native 入口。因此 `advanced-toolchain`、`advanced-toolchain-runtime` 与 `cordis-inspect-jsdoc` 描述的能力会随运行时一起消失，它们随之退役而不是迁移。迁移它们等于移植一个以操作为删除对象的运行时为目的的工具。

六个模板正好是 `PROFILE_TEMPLATES`（`rsh/Compatibility/DSH/boot/app-boot/src/profile.ts`）里的 `acp`、`web`、`headless`、`rsh`、`sdk`、`sdk-minimal`。每个都列出 `dsh --profile <name>` 组合的 bundle 层，所以「退役模板」与「删除其 bundle」是同一步；七个 bundle 目录里，`base` 被所有非 minimal 模板共享。

真正卡住叶子删除的是：这些 bundle 层就是它们最后的消费者。五个 Cordis-only 叶子——`session-stats`、`session-turn-outline`、`session-checkpoint-policy`、`file-reference-local`、`agent-tool-presentation`——各只有一个依赖方，而那个依赖方正是 T-F 要退役的 `web-app`、`base` 或 `sdk-runtime` 层。它们不能在各自的 bundle 之前删除，而那个 bundle 又不能在它所服务的 profile 有 Native 等价物之前删除。

有十四个 Cordis-only 叶子包完全无人依赖，但「叶子」不等于「死代码」。它们分三类：

- **钉住的 Cordis 源码。** `@redspark/cordis-plugin-logger-console` 属于 Cordis 那棵树，随树一起消失，而不是更早。
- **仍在使用、只是没有装进任何已发布组合的功能包。** `tool-str-replace-editor`、`storage-sqlite`、`typert/generator`、`e2b` 两个 Provider、Python SDK 运行时闭包，以及六个 `experimental/*` 包，都是有文档、能工作的 Provider 与工具，只是没有 bundle 挂载它们。删除它们是在砍能力而不是去依赖，所以各自需要明确决策，不能一刀切。
- **已被 Native 半边取代。** 这个形状里只有 `time-context` 与 `tmux-context` 两个，现均已删除。

第三类可复用的判据是：存在 Native 兄弟包、无人依赖该 Cordis 包、且没有任何 bundle 层引用它。两个满足，其余的都不满足——所以清扫停在两个而不是继续往下推。

删除一个包会牵动它自己目录之外的四处，而每一处失败在不同门禁上：`tsconfig.host.json` 的 project 引用（typecheck）、工作区 lockfile（打包安装）、组 README 那一行以及任何链接到它的兄弟 README（翻译配对）、以及生成目录的中文评审对侧 `rsh/Docs/config-catalog.zh.md`（文档构建，表现为链接到已不存在的源文件）。前两处在本地就会暴露；后两处只有跑文档门禁时才出现，所以一次删除在 `verify-translation-pairing`、`verify-config-catalog` 与文档站点构建都通过之前不算完成。

清单是第五处，也是唯一打坏打包车道的一处：`rsh/Programs/CLI/package.json` 可能仍以 `workspace:^` 引用被删的包，而 `pnpm pack` 拒绝解析指向已消失包的 workspace 协议。typecheck 与 lint 都看不见这一点，所以删除的本地校验是 `pnpm --dir rsh/Programs/CLI pack`，它同时也是证明 lockfile 与清单一致的最快方式。

因此删除一个 Cordis 包的完整本地流程是五步：删目录与其受管文件、去掉 `tsconfig.host.json` 的 project 引用、删掉所有以 `workspace:^` 点名它的行并跑 `pnpm install --lockfile-only`、修 README 行与链接并重新记录配对，然后在提交前跑 `typecheck`、`verify-config-catalog`、文档站点构建与 `pnpm --dir rsh/Programs/CLI pack`。

## Acceptance criteria

- 删除的每一步 `verify-native-dependencies` 都通过。
- 每个被删的包，其剩余 importer 都在删除它的 PR 里点名。
- `Programs/Web` 要么迁移、要么明确记为不在范围内并写明理由。
- 收尾时 `rsh/Compatibility` 之外没有任何包 import `@redspark/cordis`。

## Risks

删除 Cordis 不是场景迁移的后续步骤，而是另一次更大的迁移，有自己的先后顺序。由实测得出三条影响规划的事实：

- **\`Core/vendor\` 必须最先或最后处理，不能卡在中间。** 那六个包就是钉住的 Cordis 源码本身；任何仍 import \`@redspark/cordis\` 的东西都传递依赖它们。
- **\`Core/subprocess\`、\`Core/storage\`、\`Core/util/launch-environment\` 是基础设施而非叶子。** 它们有 Native 兄弟包（\`subprocess-local\`、各 session 后端），但 Cordis 原件仍被依赖，所以删除顺序必须显式切断这些边，而不是靠删包解决。
- **Web 应用面是最大的一整块，而且已经迁了一半。** 它 75 个包里 33 个已跑在 Native 上；剩下 35 个多是兼容渲染器挂载的客户端 UI。完成它们是**渲染迁移**而不是运行时迁移，而这个区分决定「删除 Cordis」到底能不能达到。

这条笔记的存在是为了让下一轮先测量再删除。包计数不是计划，但没有计数的计划只是猜测。

## Alternatives considered

- **把场景迁移当成全部前置条件。** 被实测否决：场景走的是 profile，而有 113 个包只能通过迁移要移除的兼容 bundle 从 profile 到达。
- **先删 \`Core/vendor\`，因为它是最小最显眼的一块。** 否决：所有带 Cordis import 的东西都传递依赖那些源码，先删会在边被切断前把树打断。
- **把这次测量并进迁移那条 Agent Note。** 否决：那条记的是怎么迁移一个场景，这条记的是运行时到底能不能移除。它们回答不同的问题，会在不同的时候被读到。
