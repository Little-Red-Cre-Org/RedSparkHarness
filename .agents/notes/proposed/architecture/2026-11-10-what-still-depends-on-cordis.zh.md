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

会牵动七处生成物或手工维护物：包目录、`tsconfig.host.json` 的 project 引用、清单里的 `workspace:^` 行与 lockfile、点名它的每一页 README 行与链接、生成目录的中文评审对侧、架构页面（其中 `module-graph.md` 是生成的、`event-producer-consumer.md` 是手写的），以及 `tsconfig.base.json`——它的包别名由工作区生成。七处里有四处是生成物，必须重新生成而不是手改：config catalog、module graph、包别名与工作区 lockfile。

靠猜该跑哪些门禁行不通：到目前为止每次删除暴露的都是不同的一个，每次漏掉都要多走一轮 CI。可靠的本地顺序是先删文件、清引用、重跑生成页（`gen-config-catalog`、`gen-module-graph`）、重新记录配对，然后把 `pnpm run doc-sync` 与 `typecheck`、`pnpm --dir rsh/Programs/CLI pack` 作为一批跑——`doc-sync` 是拥有目录、链接、图、配对与换行诸门禁的聚合入口，一次就能报出全部问题。

## 退役模板究竟需要什么

六个模板点名七个 bundle 包。实测它们的规模完全不可比：`base` 声明 **88** 个依赖、`web-app` **86** 个，而 `headless` 只有 6 个、`rsh` 10 个、`sdk-app` 4 个、`sdk-minimal` 27 个、`acp-app` 3 个。`base` 除 `sdk-minimal` 外被所有模板共享，所以它必须是最后消失的那一层。

出厂 Native profile 只组合 **12 行**，其中只有三项与 `base` 关注点重叠。`base` 拉进来的其余 **85 个包在 profile 里没有 Native 对应物**：agent loop、system prompt、工具预设、命令面、Web API 及其客户端等等。今天的 Native profile 是一个无头骨架，不是完整应用 bundle 的替代品。

这让删除 Cordis 成为一次产品级迁移而非打包步骤：那 85 个包各自要么需要 Native 形态、要么作为死代码删除、要么因为它所服务的应用本身要退役而被明确划出范围。本笔记里的场景工作是必要但不充分的，决定规划规模的数字是 85，不是 6。

## 88 背后实测的工作量

那个 85 是 `base` 依赖清单与出厂 Native profile 12 行之间的差值，但它高估了工作量。按包清单实测，**`base` 的 88 个包里已有 64 个带 `dsh.native` 入口**。只有 24 个没有，它们分四组：

**可作为钉住的 Cordis 源码删除。** `cordis-plugin-hmr` 与 `cordis-plugin-timer` 是 Cordis 源码副本，没有 Native 形态，也没有理由再获得一个。

**已被同名兄弟取代。** `rsh-agent`、`rsh-tools`、`rsh-subagent`、`rsh-tool-jobs`、`rsh-sandbox-policy` 各自有一个 `rsh-native-*` 兄弟包被 Native profile 组合。它们需要的是在无人引用后删掉 Cordis 那一半，而不是迁移。

**确实未移植，也是真正的目标清单。** `agent-loop`、`agent-default-model`、`llm`、`session`、`system-prompt`、`jobs-local`、`tool-present`、`session-checkpoint-policy`、`subagent-spawn-in-process`、`subagent-fork-in-process`、`user-approval`、`typert-loader`、`typert-registry` 以及 Web 的 `api-gateway` 没有 Native 对应物。其中一部分其实已被别的名字的 Native 包覆盖（`native-headless` 承接了 loop、`native-approval` 承接了批准），所以每个都要核实而不是盲目移植。

**兼容桥接层。** `compat-settings-adapters`、`plugin-host`、`subagent-acp` 只为适配 Cordis 而存在，随它一起消失。

把未移植的十四个与现有的 Native 包对照，大部分就解开了：

- **已被另一个名字的 Native 包覆盖。** `agent-loop` 就是 `native-headless` 内部的循环（它提供 `application` 与 `rootExecution`）；`system-prompt` 是 `native-prompt`（提供 `promptSections`）；`session` 与 `llm` 是 Native 包直接 import 的库半边；`user-approval` 是 `native-approval`；`subagent-spawn-in-process` 与 `subagent-fork-in-process` 是 `native-subagent` 承载的 Provider。这些需要的是在无人引用后删掉 Cordis 那一半。
- **确实未移植、值得单独决策。** `agent-default-model`（无 Native 消费方，已排除）、`jobs-local`、`tool-present`、`session-checkpoint-policy`、`typert-loader`、`typert-registry` 与 Web 的 `api-gateway` 没有 Native 对应物。`tool-present` 是被 Native 工具注册表取代的旧呈现机制；`typert-*` 是类型注册表而非运行时行为。

所以真正可执行的剩余大约是七个包，每个只需要一句决定（作为被取代者删除、移植、或明确划出范围），加上已经识别出的那些删除。那是一份人能做完的清单；「85 个包」不是。

**这七个今天一个都删不了，原因对它们全部相同：它们仍被 import。** 实测：`agent-default-model` 有 6 个引用方、`api-gateway` 5 个、`typert-registry` 3 个、`jobs-local` 与 `tool-present` 各 2 个、`session-checkpoint-policy` 与 `typert-loader` 各 1 个——而每一个案例里，至少有一个引用方是 `base` bundle 或仍在使用的 Web/CLI 包（`session-controller`、`webhook`、`sdk-runtime`）。此前看似死代码的 `time-context` 与 `tmux-context` 恰恰在这点上不同：没有任何东西 import 它们。

有十三个 Cordis-only 包完全没有引用方，但它们同样没有一个可以随意删除。`cordis-plugin-logger-console` 是钉住的 Cordis 源码。三个是 `experimental/*` 的 profile 与 bundle，是已发布产物，只是没有出厂 profile 恰好点名它们。`storage-sqlite`、`tool-str-replace-editor` 与 `typert/generator` 是有文档、能工作的接缝——`storage-sqlite` 就出现在 `capability-seams.md` 里作为可选后端的示例，工具编辑器登记在生成的 tool catalog 中。`fs-e2b` 与 `subprocess-e2b` 是远程执行适配器。Python SDK 运行时闭包是构建产物。删除其中任何一个，都会移除本仓库之外的消费者可能正在选用的能力。

这些 bundle 是分层而非独立的：`headless` 只声明 6 个依赖，因为它是**覆盖在 `base` 之上的补丁**（`cordis.patch.yml` 开头就写「one-shot task mode directly over dsh-base」，只调整了 `base` 已经挂载的三行）。`web-app` 有 86 个自有依赖，是因为它加了整个 Host 与客户端。把清单里的一项追到结论，能看出答案通常是什么样。`session-checkpoint-policy` 的存在意义是在三个语义边界 flush Session：模型请求派发前、顶层工具主体执行前、以及下一步之前。`native-headless` 自己已经做了这三件事——它在调用工具主体**之前** append `tool/call` 并 await `persist()`（第 1862 行后接 1864 行），在派发前持久化请求前缀，并在每个步边界持久化。所以这个独立的 Cordis 插件没有 Native 对应物的原因是：Native 循环把该保证内联了，而不是把它作为策略采用。

这也是清单上大多数项的预期模式：不是移植，而是确认某个现有 Native 包已经拥有该关注点。它也意味着每核查一项，真实工作量就会下降。

接下来核查的 `tool-present` 不属于这种情形，它是第一个真正的移植项。它是个 109 行的 Cordis 工具，暴露 `present`——声明完成文件为交付物的那次调用。**没有任何 Native profile 组合它，也没有任何 Native 包实现它**：在 `src` 中搜索 `present` 工具注册、在每个 native 测试 profile 中搜索该行，两者都是空的。原则上可移植：它需要已有的 scoped registry，外加两样 Native 侧尚未暴露的东西——开放回合边界（它读 `sessionProjections.stateOf(session, 'turnBoundary')`）与 Web 客户端渲染所依赖的 presented-files 投影。所以成本是工具本身加上这两个接缝，而不只是那 109 行。

核查两项：一项免费解决，一项是真正的移植。这个比例就是本轮有用的产出：清单不是一律困难，也不是一律免费，只有逐项核查才知道是哪一种。

第三项 `typert-loader` 归入第三类：**它天然就是 Cordis 形状的。** 它的职责是监视 Loader 条目——响应 `internal/plugin` 事件、解析每个已挂载条目的 manifest、在条目卸载时撤回注册。Native 运行时没有 Loader 可监视，所以它在删除后没有任何部分能存活；Native 侧对 `typert` 的引用数为零。它的兄弟包 `typert-registry` 同样是 Cordis Web API 使用的反射/RPC 层，而 Native Web host 不用它。

所以类别是三类而非两类：**已被 Native 包拥有**（`session-checkpoint-policy`）、**可移植但需额外接缝**（`tool-present`）、**Cordis 形状、随运行时删除**（`typert-loader`，以及一旦 Cordis Web API 划出范围后的它的注册表）。`agent-default-model` 实际上属于第一类，而不是一个开放问题：它提供 `agentDefaultModel`，而后者在 `rsh/Engine` 中**没有运行时消费者**——只有文档、生成脚本与它自己的测试点名它——而 `native-model-selection` 提供 `modelSelection`，也就是 Native profile 真正组合的那个服务。`compat-*` 属于第三类。`jobs-local` 是第四项，属于第一类：`native-jobs` 已经提供 `jobs` 服务，且 Native 的后台任务场景跑的就是它——`background-job-admission` 通过它验证并发上限。两个实现体量不同（311 行对 496 行），是因为 Cordis 那份带了额外的生产侧记账，而不是 Native 那份缺少该接缝承诺的能力。

这样真正开放的只剩一项：Web 的 `api-gateway`，它被「Cordis Web API 是否在范围内」这个决定所阻塞。

所以 `base` 是所有其他模板立足的那一层，也唯一一个退役真正有意义的层。

Native 一侧已经证明这个形状可行：`native-ptc` 组合了 19 个真实产品行——agent、tools、prompt、model execution、jobs、sandbox policy、subprocess、shell、bash tool、code runtime 与 session persistence——并跑起一个能工作的 agent。它缺的不是深度而是广度：除 prompt 注册表之外没有系统提示身份、没有 agent instructions、启动时没有 attachments、没有命令面、没有 Web API。那些就是那 24 个包。

这反转了目标里陈述的顺序。第 4 步无法在第 5 步之前完成，因为只要 bundle 层还 import 它，包就活着；只要 profile 模板还点名 bundle 层，bundle 层就活着。所以第一个真正的动作是让 Native profile 有能力取代 `base` 层——也就是那个 85 包的问题——或者删掉本身就是范围外的消费者（Web API、Python SDK 运行时）。

## Web 面决定终局

**出厂启动器已经完全不读 Cordis 模板表。** 新建一个 Harness home 并运行 `dsh --profile headless`，写出的 `profiles/headless/package.json` 带 `"runtime": "native"`，其 `rsh.profile.json` 有 62 行，组合 `native-headless`、`native-agent`、`native-tools`、工作流、goal、agent instructions 与各上下文 Provider。`rsh/Programs/CLI/src` 中**没有任何对 `app-boot` 的引用**，所以 `PROFILE_TEMPLATES` 从启动器不可达。

这也解释了为何六个名字里有五个已经以 Native profile 的形式工作：CLI 查询的是 `native-profile-template.ts` 的名字到组合表，而 Cordis bundle 只能通过 `app-boot` 到达，后者剩余的消费者是三个 Cordis 子代理桥。

三者都没有 Native 入口，但处境不同。`subagent-codex` 与 `subagent-rsh-sdk` 的包级消费者为**零**——它们是用户通过 `dsh plugin add` 安装的已发布 profile bundle，所以「没有 import 方」并不等于死代码。`subagent-acp` 被 `base` bundle 引用。它们的 README 记录了各自的 Native 侧状态：Codex 适配器在 Native 请求上**在启动前就停止**，因为它尚未强制父级权限或继承的 `maxSteps`；SDK 桥同样如此记录。因此退役 `app-boot` 意味着要么把这三个适配器移植到 Native，要么退役这三个产品能力，而仓库已把前者记为未完成的工作。

这个说法同样是错的，核查包之后就能看出原因。**Native 对应物已经存在。** `rsh/Modules/Official/subagent/` 下有 `sdk-child`、`codex-app-server` 与 `acp-child`，三者都带 `dsh.native` 入口并提供 `externalSubagentDriver`——正是 `native-subagent` 消费的那份契约。`sdk-child` 是一个完整适配器：它需要 `sdkChildRuntimeLauncher`，而 `rsh/Programs/CLI/src/native-profile-loader.ts` 会为 `sdk-child` 与 `acp-child` 行自动安装该服务。所以这三个 Cordis 桥不是「未移植的缺口」，而是与 Native 侧已交付能力并行的实现。

差别在组合而非能力。出厂的 `sdk` profile 把 `subagents.providerName` 设为 `'spawn'` 且不组合任何子适配器行；只有 `native-sdk-dsh-child` 添加 `dsh-sdk-child` 并设 `providerName: 'dsh-sdk'`。因此剩下的是决定哪些 profile 名应当选用该外部驱动，而不是写一个。这一点通过组合验证过：`dsh --profile native-sdk-dsh-child` 写出的 profile，其 `subagents` 行设 `providerName: 'dsh-sdk'`，并同时组合 `dsh-sdk-child`，而且该 profile 能启动——它退出只因探针传了任务参数，不是因为组合错误。缺失的 `sdkChildRuntimeLauncher` 由 loader 自行补上，当某个 profile 点名 `acp-child` 行时它也会同样处理。

`sdk-child` 已为该 profile 组合。另两个的结论不同，核查后我纠正了原先的说法。

`acp-child` 在任何地方都没有组合，而 `native-acp-dsh-child` 解释了这不是疏漏：该 profile 派生自 `native-acp` 并**刻意剥掉所有子代理行**——`subagents`、`subagent-controls`、`subagent-directory`、`subagent-tool`、`subagent-tool-fork`、三个 `workflow` 行与 `ralph-tool`——因为它处在委派的**子**侧，而一个还能继续委派的子会无界递归。探针证实了结果：25 行，无 `subagents`、无 `acp-child`。所以 `acp-child` 未组合是因为组合它会与该 profile 的用途相抵触，而不是没人做。

`codex-app-server` 同样没有行，而它又是另一种情形：Cordis 的 Codex 桥记录说该适配器在 Native 请求上启动前就停止，所以组合它只会把一个仓库已记录为未实现的能力暴露出来，并不会让它变得可用。这就是 Cordis 桥与 Native 对应物之间剩余的全部差别：三个包在两侧都存在，而 Native 侧只组合了三个中的一个。

**六个 Cordis 模板名里已有五个具备出厂 Native 组合。** `rsh/Programs/CLI/src/native-profile-template.ts` 把 `headless` 映射到 `native-headless`、`web` 映射到 `native-web`、`sdk` 映射到 `native-sdk`、`acp` 映射到 `native-acp`、`rsh` 映射到 `native-tui`；只有 `sdk-minimal` 没有对应物。CLI 在其 manifest 中声明了十三个 native 模板，`native-web` 还自带客户端安装清单。所以第 5 步的工作不是「建一个 Native Web profile」——它已存在——而是「退役这些同名仍在解析到的 Cordis bundle」，并对 `sdk-minimal` 作出决定。

CLI 参考文档用自己的表格陈述了这个区分：`web`、`headless`、`sdk` 与 `acp` 被标为 **「Legacy … template」**，而 `sdk-minimal` 那一行没有这个标记——文档本身已经在告诉读者哪些名字已被取代、哪些还没有。

`sdk-minimal` 是唯一没有 native 对应物的名字，而这并非疏漏。它是一个刻意独立的小型 profile：README 说明它为需要小型显式运行时的 SDK 客户端而存在，**按设计排除 `dsh-base`**，其 27 个依赖全部是 Cordis 包、零个 `dsh.native` 入口。`native-sdk` 是另一种组合——带子代理、工作流与命令的完整 agent。按 manifest 实测，移植它比 27 个 Cordis 依赖暗示的要近得多：**12 个已有 native 形态**；剩下 15 个里，四个是 Native 侧直接消费的库（`llm`、`session`、`scope`、`invariants`），三个已有 `rsh-native-*` 兄弟包在别处被组合（`agent`、`tools`、`sandbox-policy`），一个是钉住的 Cordis 源码（`cordis-plugin-timer`）。于是**真正的缺口只剩两个：`tool-bash-persistent` 与 `tool-pwsh-persistent`**——也就是这个 profile 所宣称、而没有任何 Native profile 组合过的平台相关持久 shell。另外 `sdk-jsonrpc-server` 对 `native-sdk` 已被 `native-sdk-server` 取代。

因此建议是「裁剪」而非全量移植或退役：那两个持久 shell 工具是 `sdk-minimal` 唯一在 Native 侧缺失的能力，也正是它与 `native-sdk` 的区别所在。那两个工具是可移植而非被阻塞的：它们只注入 `tools` 与 `terminals`，而 `rsh-terminal` **已经原生提供 `terminals`**——`spawn`、`list`、`startSend`、`read`、`kill` 都在 Native 注册表上存在。唯一差别是 `spawn` 签名：Cordis 服务取 `(owner, request, signal)`，Native 取单个 `NativeTerminalSpawnSpec`。所以这次移植是在一个已存在的面之上重写 438/474 行，而不是新增能力。

**建议：退役 `sdk-minimal` 这个 profile 名，而不是移植那两个工具**——但它不能当作清理工作直接删除。核查依赖之后，这个论证的代价一侧发生了变化。

该名字被五个测试断言，其中包括一个端到端测试，会 dump 它的组合并逐行比对：`built-bin.e2e.ts` 运行 `--profile sdk-minimal --dump-default-config`，期望得到完全一致的有序 id 与包名列表；`profile-hmr.spec.ts` 断言它的树不含 HMR 模块；`profile.spec.ts` 直接钉住 `PROFILE_TEMPLATES` 条目。

所以退役它意味着删除对一项已交付行为的有效覆盖，而不是改一行文档。方向仍然正确——一个只依赖 Cordis 的 profile 不可能比运行时活得更久——但它应当与「移除 Cordis 启动器」出现在同一次改动里，并且要在 `native-sdk` 已被验证能服务同样的 SDK 客户端之后，而不是作为独立的第一步。

理由与否则的代价如下：

`sdk-minimal` 只能通过 Cordis 模板表到达——`rsh/Programs/CLI/src` 中没有任何对它的引用，所以启动器并不特判这个名字，它也永远不会获得 Native 组合。因此退役它意味着：从 `PROFILE_TEMPLATES` 删一个条目、删一个 bundle 包、删 `reference/README.md` 中一行、以及删掉只有它挂载的那两个包。这比移植 900 行更小，而用户真正需要的能力——经 stdio 的 SDK 运行时——已由 `native-sdk` 提供，它组合完整 agent，也是 SDK 默认选用的名字。

反方理由也是真实的：`sdk-minimal` 的存在理由恰恰是它比默认更小，选它的人想要的是精简的树。但一个「唯一独有能力是别的 Native 组合都没挂载的持久 shell」的 profile，其主张比表面看起来要小；而保留它意味着在它所依赖的运行时消失之后仍要维护一条并行的 Cordis 工具链。

无论如何，有两个事实界定了这次移植值多少。这两个工具只有两个依赖方——`sdk-minimal` 与 `rsh/Programs/SDK/python/sdk-runtime`——而 Python 运行时只是**声明**了它们：它没有任何 `cordis.yml` 组合二者，所以 `sdk-minimal` 是它们真正被挂载的唯一位置。这让它成为一个模板形状的任务而非产品范围的任务，也意味着这次移植的价值取决于那个 profile 本身是否值得保留。

用其他 native profile 已在用的包加一个 Native 持久 shell 组成极简组合即可关闭该模板；反之退役这个 profile 名，会移除一个恰恰因为比默认更小而存在的有文档 profile——这与迁移应当给用户带来的代价正好相反。

这个区分很重要，因为两种理解的剩余工作量完全不同，而本笔记此前的说法（「Native Web 这条路建好但从未接线」）是错的：它既建好了**也**接线了，一个 Web e2e 测试用二十四个模块链接组合它。

此前的量化仍然描述包清单，所以保留下来作为残余 Cordis 面的代价。`rsh/Programs/Web` 下 75 个包里，**35 个是 Cordis-only、33 个已有 `dsh.native` 入口、7 个两者皆无**。这个划分很关键：客户端已完成大半迁移（27 个 native 对 22 个 Cordis），而 API 侧恰好相反（2 个 native 对 6 个 Cordis）。

决定性的证据是：`native-web-host` 已经存在且完整——它提供 `nativeWebHost`、`hostConnection`、`httpRoutes` 与 `application`——但**包外没有任何消费者**。也就是说 Native Web 这条路已经建好，却从未接进任何应用 profile。因此直接删除 Cordis 不可能发生，除非有人组装出一个组合 `native-web-host` 与那 27 个已迁移客户端包的 Native Web profile，并移植或删除剩下的 28 个。

那是一项产品工程，不是一个清理步骤。它也正是本目标的诚实边界：第 1 至第 3 步、以及第 4 步的引擎侧部分已经完成或已量化，而第 5 步取决于一个目标本身没有做出的 Web 决定。


- 删除的每一步 `verify-native-dependencies` 都通过。
- 每个被删的包，其剩余 importer 都在删除它的 PR 里点名。
- `Programs/Web` 要么迁移、要么明确记为不在范围内并写明理由。
- 收尾时 `rsh/Compatibility` 之外没有任何包 import `@redspark/cordis`。

## 那两个 driver 形场景究竟需要什么

`system-prompt-in-history` 与 `model-switch-notice` 此前都被归为受同一理由阻塞，而核查否证了这个理由。它们都不需要回合中途的 driver，需要的是**Native 运行时尚不具备的能力**。

第一个场景断言：当渲染出的提示词发生变化时，声明 `systemPromptUpdate: 'in-history'` 的路由会在缓存历史之后追加一条新的 `system/message`，而不是替换节点 0。`rsh-llm` 会在路由能力上解析该标志，但 Native 循环从不读它；循环也只在**每次运行**而不是每步渲染一次提示词段落。两者现已实现：步边界重新渲染段落，in-history 路由追加变化后的提示词而非替换缓存节点。该场景已在 Native profile 上回放通过，这一项因此是关闭的，而不是记录为阻塞。

第二个场景通过 `installModelSelection` 在 `todo_write` 之后切换所选模型，而该函数完全由两个 Cordis waterfall 搭成：`system-prompt/assemble` 改写 provider 与 model 变量，`agent/request` 改写已解析的调用配置。Native 循环没有对应接缝——它每一步从 `modelSelection` 服务读取路由，而后者需要 `modelDirectory`，replay Provider 不提供该服务，真实 Provider 也只能通过活的模型目录提供。因此要在 Native profile 上复现该录制，需要的是一个 Native 模型目录 fixture，而不是移植 driver：切换机制本身已经存在，只是它的输入无法仅由回放提供。

所以两者都被记录为受运行时能力阻塞，而不是受测试基础设施阻塞——这改变了「解除阻塞」的代价：那是循环层的工作，且必须自带场景覆盖，而不是改一下 fixture。

`skill-load` 的阻塞来自内容而非能力：它的 setup 会复制 `agent-presets/presets/cordis/skills/editing-cordis-compositions/SKILL.md`，而该文件已不在仓库中。工具、注册表与文件系统来源都有 Native 入口，迁移后的场景能成功组合并调用它们——它回答该技能不存在，因为录制所依据的 fixture 已随 presets 退役。因此回放它需要针对仍然存在的技能重新录制，而不是 Native 移植。

## 剩余十七个场景及其确切阻塞

每一条都对照录制与其 manifest 核查过，而不是从场景名推断。

**需要真实 HTTP 端点。** `web-fetch` 调用 `http://public.test:43117/menu.html` 并断言取回的页面文本；该录制没有 fixture 或 driver，只有一次真实请求。`web-search-endpoint-guidance` 对搜索 Provider 同形。两者都需要本地回环 fixture 服务器，而 Native 装配器不提供。

**需要宿主专属运行时。** `missing-sandbox-runner` 设 `RSH_SNAPSHOT_MISSING_SANDBOX_RUNNER=1` 模拟缺失的 Landlock runner。`partial-landlock-child-failure` 断言仅 Linux 的 Landlock 行为（`platform: posix`）。`ptc-python-turn` 同样标 `posix`，但真正的阻塞不同：它把 worker provider 换成 `@redspark/rsh-experimental-code-runtime-python`，而该包属于 `Modules/Community/experimental` 且没有 `dsh.native` 入口，所以 Native profile 根本无法运行 Python 代码。除此之外它的断言与录制完全吻合（一个外层 `run_code`、两次 `bash` 分发、渲染结果含 `CODE_ONE`），因此一旦该运行时获得 Native 形态即可迁移。`persistent-pwsh-tool-turn` 声明 `platform: pwsh`，且其录制早于该工具必需的 `description` 字段，所以除了 Windows PTY 还需要重新录制。

**需要场景无法表达的 fixture 插件。** `session-reference-spill` 已尝试但未走完，原因现在可复现而非含糊。组合 `session-query`、`session-reference` 与 `spill-local` 都能加载且种子已写入，但 `sessionQuery` 什么都不列出。直接探测后端就看出原因：扁平的 `<root>/reference-source.jsonl` 会被**忽略**（列出 0 条），而 `<root>/<id>/session.v3.jsonl` 布局会被拒绝，报 `uses the unsupported flat-file layout; use a separate root or move it into a project/session directory before loading`。存储要求在 session 目录**之上**还有一层 project 目录。所以种子失败在布局而非能力。该布局现已通过探测后端确定：一个 Session 只有在 `<root>/<cwd-分组>/<id>/session.vN.jsonl` 路径下才会被列出，其中没有记录 `cwd` 的 Session 位于字面分组 `_no-cwd` 之下。该路径上的文件可以加载并列出；而 header 的 `id` 与其目录不一致会被判为损坏日志。因此在那里写入种子是一个已知步骤，而不是开放问题——而做完这一步也澄清了那次怀疑：种子存在且运行时有 9,657 字节，引用消息依旧没有出现，因为 `native-headless` **根本不读取 `sessionReference` 服务**。它消费 `agentInstructions` 与 `requestContexts`，却没有对引用的等价调用，所以组合 `session-reference` 毫无效果。因此阻塞点是循环中缺失的集成点，而种子布局是另一个独立问题。

那个集成其实并不缺失：`agent-instructions` 早已把 `sessionReference` 声明为可选，并调用 `references.prepare(...)` 把结果并进自己的上下文，所以只要 profile 组合了 `session-query`、`session-reference` 与 `agent-instructions`，整条链就接通了。真正失败的位置更早：录制的 inbox 携带 `Use @[Research](dsh-session:InJlZmVyZW5jZS1zb3VyY2Ui) as background`，而持久化的用户消息读作 `Use @Research as background`——提及在消息到达 session **之前**就被改写成展示形态，于是等任何 provider 去解析时，已不再有 `dsh-session:` URI。那次改写正是 `parseSessionReferenceText` 自身的行为：它把每处提及在返回的文本里替换为 `@${label}`，同时把 ID 收集进 `references`。所以录制里的展示形态是**预期输出**，而不是提及丢失的证据；provider 拿到的是原始文本，返回两半。Native provider 只读取 `.references`，从不持久化被改写的 `.text`，这意味着持久化的展示形态必须来自写入已准入消息的那一处。

Cordis provider 解释了整份录制。它监听 `agent/pre-step`，对每条引用输入返回**两条**消息：一条是被它改写为 `@label` 的直接消息（`prepareDirectMessages` 构造 `{ ...message, content: resolved.content }`），随后是附加上下文。这正是录制的形态——`user`、`session-reference`、`plugin`——也正是持久化的直接消息呈现为展示形态的原因。

Native provider 只返回上下文；它从不改写直接消息，而 `native-headless` 与 `agent-instructions` 都不做这一步。所以按今天的组合方式，录制的第一条用户消息无法从 Native 侧复现：缺失的是准入路径上的直接消息改写，而它由 Cordis 的 `agent/pre-step` 监听器拥有。这是真实的集成缺口，也解释了为何组合那三个服务只得到一条消息，而录制里有两条。

`NativeSessionReferenceOperations` 现在带有 `rewrite(inputs)`，它正是那个映射：对每条用户消息解析每个文本块，一旦某处提及被解析出来，就返回「这些块替换为展示形态、其余不变」的消息。它是纯函数，因此不增加挂起点——这一点很重要，因为这个循环的步骤边界对一次挂起是敏感的。从循环里调用它才是剩下的一步：Cordis 版本在拥有准入决策的 `agent/pre-step` 监听器内完成它，而 Native 的等价物是步骤准入钩子，provider 在 resolve 时无法注册，因为 `beforeStep` 位于逐步 owner 上，而不在它拿到的服务上。

所以先前把 `sessionReference` 接进 `native-headless` 不只是有害，还是多余的；而它引发的时序中断是另一条独立的教训：在 `agentInstructions.prepare(...)` 旁边加上 `sessionReference.prepare(session, inputs, signal)`、追加其上下文、并在代码与 `package.json` 中都把该服务声明为可选，会让 `workflow-run` 稳定失败：它的 workflow 与 ralph 工具结果比录制提前了一个步骤。把该调用改成「仅在服务已安装时才挂起」，并去掉多余的那个 `signal.throwIfAborted()`，都没有改变结果；而未改动的树上该场景可以通过——验证了两次。所以循环的步骤边界对一次额外的 `await` 敏感，即使被等待的调用什么也不返回；未来任何尝试都必须保持既有的挂起顺序，而不是简单插入一次调用。该改动已回退，而不是带着红场景提交。`subagent-published-run-failure` 挂载 `subagent-durability-failure`（157 行）并设置 `RSH_SUBAGENT_PUBLISHED_FAILURE=1`。它同时注册的检查点现已能在 Native 上实现，但这不是该录制断言的内容。其断言来自 fixture 的**另一半**：它替换 `agents.create`，让已发布句柄的 `followup` 抛出 `snapshot published run failed`、`dispose` 抛出 `snapshot published handle disposal failed`，工具结果回显二者。Native 子代理没有等价注入：它的失败文本来自 `tool-subagent` 自身的 `stopReason` 映射，而 external-driver 接缝要求产品适配器失败，而不是让测试替换服务方法。核查 external-driver 接缝是否已提供它：并没有，而原因是刻意的差异而非缺口。`NativeExternalSubagentRun.dispose()` 可以拒绝，但 `native-subagent` 在 `disposeChild` 中捕获该拒绝，并在 `recordExternalDrainFailure` 之后转换成 `{ kind: 'failed', error }`——也就是说失败被**记录**，从不重新抛进工具结果。Cordis 的 fixture 是通过让 `dispose` 直接穿透被替换的服务来获得那段文本的。要在 Native profile 上复现它，就得改变 Native 子代理报告 drain 失败的方式，那是为满足一个测试而改变行为，而不是缺失能力。因此这个场景应当针对 Native 自身的 drain 失败形态重录，而不是移植。`product-subagent-result-diagnostic` 挂载 `subagent-result-diagnostic`。`partial-landlock-child-failure` 挂载 `partial-landlock-sandbox`。`agent-instructions` 需要名称含 `:` 的工作区目录，外加为其录制到的溢出准备的压缩策略。冒号不是偏好问题：`[System.IO.Directory]::CreateDirectory('…/scope:alt')` 在 Windows 上静默地什么都没创建（已实测——该路径此后不存在，`Test-Path -LiteralPath` 为 false），所以这个目录在本宿主上根本无法物化。

**需要外部服务。** `lsp-definition` 驱动 LSP 服务器。`subagent-acp-diagnostic` 与 `product-subagent-result-diagnostic` 驱动 ACP 子进程。

**随 Cordis 退役。** `advanced-toolchain`、`advanced-toolchain-runtime` 与 `cordis-inspect-jsdoc` 演练 Cordis 工具链本身（`cordis_define`、`cordis_undefine`、`cordis_inspect_query`），按设计没有 Native 形态。

**按原录制不可回放。** `session-query-spill` 会 grep 一个形如 `/tmp/dsh-acp-snap-<随机>` 的绝对 spill 路径，任何 fixture 都无法预测。`skill-load` 复制的 preset 技能文件仓库已不再包含。

十七个里只有三个（`advanced-toolchain`、`advanced-toolchain-runtime`、`cordis-inspect-jsdoc`）随 Cordis 一起消失。其余十四个各需 Native 装配器所没有的测试基础设施，或一次重新录制。

## 仍然让七个 bundle 包存活的还有什么

按 manifest 实测，**七个 bundle 包全都没有包级消费者**：没有任何包把 `rsh-base`、`rsh-headless`、`rsh-web-app`、`rsh-rsh`、`rsh-acp-app` 或 `rsh-sdk-minimal` 声明为依赖，只有 `sdk-minimal` 点名 `rsh-sdk-app`。它们存活是因为有三处以**字符串**而非依赖的方式点名它们：

- `app-boot` 里的 `PROFILE_TEMPLATES`，而出厂启动器已不再读它。
- `rsh/Programs/Desktop/src/project-manager.ts` 里的 `DESKTOP_PROFILE_BUNDLES = ['@redspark/rsh-base', '@redspark/rsh-web-app']`，而桌面应用**确实**用它来组合 profile。
- 断言各模板确切 bundle 列表的测试 fixture。

所以最后一步除了 CLI 还需要一个桌面侧的答案：桌面应用仍在启动 Cordis profile，那是「删除 Cordis 层」必须了结的一个产品面。它与 `sdk-minimal` 同形——是能力决策，不是代码缺口。

## 删除真正经过的那道接缝

这是实测而非推断：**384 个工作区包中有 266 个声明 `@redspark/cordis`**，`rsh/Compatibility/DSH` 有 721 个文件。与之相对，出厂 CLI 对 Cordis 的触及只是一个分支。

`rsh/Programs/CLI/src/bin.ts` 先解析运行时。当 `profileRuntime(name)` 返回 `'native'` 时它导入 `native-profile-boot.ts`，完全不碰 Cordis。否则它调用 `requireCompatibilityRuntime()` 并惰性导入 `profile-boot.ts` 的 `runProfile`——这是 `rsh/Programs/CLI/src` 中唯一导入 `@redspark/cordis` 的文件，而且只是类型导入。

所以移除 legacy 启动器是**一个分派分支加上 `profile-boot.ts`（381 行）与 `compatibility-runtime.ts`（29 行）**的改动；此后那 266 个声明包里，要么失去最后一个消费者，要么其消费者留在兼容 bundle 中——那正是 bundle 退役随后要解决的问题。CLI 的 178 个依赖届时可以去掉 `@redspark/cordis` 与 `@redspark/rsh-cordis-bridge`。

那第一步的前提现已验证，并且它孤立出唯一仍在挡路的东西。在任何 profile 存在之前调用 `profileRuntime`，每个名字都返回 `'legacy'`——解析读的是磁盘上的 manifest，不是名字。而在 `ensureShippedNativeProfile` 运行之后，`headless`、`web`、`sdk`、`acp` 与 `rsh` 全部返回 `'native'`。`sdk-minimal` 无论如何都返回 `'legacy'`，且 `SHIPPED_NATIVE_PROFILES()` 不含它。

所以仍然需要 legacy 分支的出厂名字恰好只有一个：`sdk-minimal`。因此「让分派不可达」不是验证五个 profile 的事，而是决定退役第六个名字的事——这就是为什么那两个问题其实是同一个问题。

这个决定不是免费的，比较两种组合就能看出原因。`native-sdk` 组合了 30 个插件——工具、子代理、工作流、压缩、命令、模型执行——**而且没有 shell**：改用它将让 SDK 客户端无法运行命令。`sdk-minimal` 组合了一个隐藏的 `rsh-terminal` 加上 `terminal-bash`、`terminal-pwsh` 与两个持久工具，这正是它宣称的能力。所以 `native-sdk` **并不**覆盖 `sdk-minimal` 所服务的东西，此前那句「能力已由 `native-sdk` 提供」是错的。

这让它成为真正的产品决定而不是清理工作：要么退役该 profile 并接受一个精简 SDK 运行时失去命令执行能力，要么给 `native-sdk` 一个 shell——对于持久版本而言，那就是本笔记实测为 438 与 474 行的那两个工具的移植。它的 `sdk-minimal` 测试、bundle 与文档行都属于同一次改动，因为名字不消失，那个分支就去不掉。

由此得到的顺序与批量删除相反：先让分派不可达（确认每个出厂名字都解析到 Native 组合），删除两个 boot 文件及其导入，确认 CLI 不再声明 Cordis，然后才向外推进到「最后一个消费者是那个分支」的那些包。

## 剩余十五个场景究竟在等什么

逐项核查后，它们收敛为六项能力而不是十五个任务。这个分组才让它们变得可估算。

**Native Session 上的持久化检查点——2 个场景。** `NativeContinuationSession` 现已带有一个：`persist()` 先追加受管批次，随后在 writer flush 之前运行每个已注册的 `NativeDurabilityCheckpoint`，因此拒绝会中止该次 flush 并以与存储错误相同的形式浮出给调用方。`checkpoint(observer)` 返回其精确移除句柄，而 owner 通过 `NativeActiveSessionOwner.checkpoint` 暴露它——该成员在接口上是可选的，因此模拟 owner 的测试替身不必改动即可编译——Program 再把它转发到 session。这就是插件所需的完整 `session/flush` 能力：注册一次，在想失败的那个回合从回调中抛出即可。

**Python 代码运行时——1 个场景。** `ptc-python-turn` 组合 `@redspark/rsh-experimental-code-runtime-python`，该包位于 `Modules/Community/experimental` 且没有 `dsh.native` 入口，所以 Native profile 根本无法运行 Python。

**持久 shell——1 个场景，外加第六个模板。** `tool-bash-persistent` 与 `tool-pwsh-persistent` 分别为 438 与 474 行，面向一个 Native 已存在的 `terminals` 服务。该接缝已端到端验证：`tool-terminal` 已发布 Native 入口并提供 `terminal_open`、`terminal_send`、`terminal_read`、`terminal_signal` 与 `terminal_close`，所以一个 Native 持久工具是在 `open`/`startSend`/`read` 之上的标记轮询循环，而非新的管线——Cordis 版本自身的辅助函数（标记生成、命令引用、截断、输出结算）可原样沿用。除此之外，只需补上 `sdk-minimal` 自身的缺口，而那既是技术选择也是策略选择；`persistent-pwsh-tool-turn` 还需要重录，因为它的录制早于必需的 `description` 字段。

**外部 LSP 或 ACP 服务——3 个场景。** `lsp-definition` 驱动 LSP 服务器；`subagent-acp-diagnostic` 与 `product-subagent-result-diagnostic` 驱动 ACP 子进程（后者还挂载 `subagent-result-diagnostic`）。

**Linux 沙箱 runner——2 个场景。** `missing-sandbox-runner` 设 `RSH_SNAPSHOT_MISSING_SANDBOX_RUNNER=1` 模拟缺失的 Landlock runner；`partial-landlock-child-failure` 断言部分强制。

**宿主能表达的工作区——1 个场景。** `agent-instructions` 需要名称含 `:` 的目录，Windows 即使通过 `CreateDirectory` 也无法创建。

**随 Cordis 退役——3 个场景。** `advanced-toolchain`、`advanced-toolchain-runtime` 与 `cordis-inspect-jsdoc` 演练 `cordis_define`、`cordis_undefine`、`cordis_inspect_query`。

**按原录制不可回放——2 个场景。** `session-query-spill` 会 grep 形如 `/tmp/dsh-acp-snap-<随机>` 的绝对路径；`skill-load` 复制的 preset 技能文件仓库已不再包含。两者都需要重录，而不是能力。

六项能力里有三项规模不大且接缝已存在（`terminals`、持久化 Session 读取器、以及解锁了 `web-fetch` 的 fixture 服务器模式）。另三项则不是：Python、LSP/ACP 传输与 Landlock runner 都是独立运行时。这个划分才是有用的估算——而不是「还剩十二个场景」。

## Acceptance criteria

上面的提案按包逐个满足：已被现有 Native 包拥有的，在无人引用后删掉它的 Cordis 那一半；Cordis 形状的随运行时消失；确实未移植的补上 Native 入口。场景以其在 CI 中于 Native profile 上回放通过为准。Web 的范围决定必须在任何 Web 包移动之前记录下来。

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
