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

唯一仍未闭合的那一项——Web 的 `api-gateway`——不是包的问题而是范围的问题，而实测决定了每种答案的代价。`rsh/Programs/Web` 下 75 个包里，**35 个是 Cordis-only、33 个已有 `dsh.native` 入口、7 个两者皆无**。这个划分很关键：客户端已完成大半迁移（27 个 native 对 22 个 Cordis），而 API 侧恰好相反（2 个 native 对 6 个 Cordis）。

决定性的证据是：`native-web-host` 已经存在且完整——它提供 `nativeWebHost`、`hostConnection`、`httpRoutes` 与 `application`——但**包外没有任何消费者**。也就是说 Native Web 这条路已经建好，却从未接进任何应用 profile。因此直接删除 Cordis 不可能发生，除非有人组装出一个组合 `native-web-host` 与那 27 个已迁移客户端包的 Native Web profile，并移植或删除剩下的 28 个。

那是一项产品工程，不是一个清理步骤。它也正是本目标的诚实边界：第 1 至第 3 步、以及第 4 步的引擎侧部分已经完成或已量化，而第 5 步取决于一个目标本身没有做出的 Web 决定。


- 删除的每一步 `verify-native-dependencies` 都通过。
- 每个被删的包，其剩余 importer 都在删除它的 PR 里点名。
- `Programs/Web` 要么迁移、要么明确记为不在范围内并写明理由。
- 收尾时 `rsh/Compatibility` 之外没有任何包 import `@redspark/cordis`。

## 那两个 driver 形场景究竟需要什么

`system-prompt-in-history` 与 `model-switch-notice` 此前都被归为受同一理由阻塞，而核查否证了这个理由。它们都不需要回合中途的 driver，需要的是**Native 运行时尚不具备的能力**。

第一个场景断言：当渲染出的提示词发生变化时，声明 `systemPromptUpdate: 'in-history'` 的路由会在缓存历史之后追加一条新的 `system/message`，而不是替换节点 0。`rsh-llm` 会在路由能力上解析该标志，但 Native 循环从不读它；循环也只在**每次运行**而不是每步渲染一次提示词段落。两者现已实现：步边界重新渲染段落，in-history 路由追加变化后的提示词而非替换缓存节点。该场景已在 Native profile 上回放通过，这一项因此是关闭的，而不是记录为阻塞。

第二个场景通过 `installModelSelection` 与三个根 waterfall 在 `todo_write` 之后切换所选模型。其中两个（`system-prompt/assemble`、`agent/request`）是 Cordis 扩展点，没有 Native 对应物，因此移植该 driver 意味着要设计这两者的 Native 等价物。

所以两者都被记录为受运行时能力阻塞，而不是受测试基础设施阻塞——这改变了「解除阻塞」的代价：那是循环层的工作，且必须自带场景覆盖，而不是改一下 fixture。

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
