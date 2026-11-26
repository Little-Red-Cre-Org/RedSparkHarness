# Agent Note: 为剩余浏览器场景提供一个 Native Web 脚手架

Status: proposed

[English](2026-11-24-native-web-scaffold-and-scenario-migration.md) | 中文

## Problem

[Desktop-only 退役浏览器 Web 部署](../../implemented/architecture/2026-11-21-desktop-only-retires-browser-web.zh.md) 已经点名下一步：退役浏览器 e2e lane、迁移或记录 32 个 `profile: web` 场景，并删除 `rsh-web-app`、`rsh-base` 与 Typert remote Web 面。该 lane 仍通过 `launchWebScaffold` 启动 Cordis 组合，因此每个迁移的场景还要各自承担一遍子进程引导。

已交付的 `native-*.e2e.ts` 各自重复同样八十行：建 Harness home、保留 `native-web` 行的一个子集、改写其配置、链接工作区包、写夹具模型、播种 Session、读取声明的 URL。其中两个文件还在断言与客户端不一致的契约——`native-bash-abort-row` 查 `[data-tool=bash]` 与 `[data-disclosure-row]`，而 Native Bash 卡只渲染 `data-sample`；`native-skill-tool-row` 在 `ToolCard` 把 `skill` 路由到 `NativeSkillRow` 之后仍在断言通用卡。

## Proposal

由 `rsh/Programs/Web/application/tests/native-scaffold.ts` 承担引导。`launchNativeWeb` 保留指定行集、套用持久化路径默认值（`session-controller`、`fs`、`sandbox-policy`、`credentials`、`storage`）、在场景自带历史时安装静默目录模型、通过 `JsonlSessionBackend` 播种一个 Session、以子进程启动 `dsh --profile native-web`，并返回已打开的页面。场景因此只需声明行集、种子与断言。

两条契约对齐到共享的 disclosure 词汇，迁移后的场景在两种面上查询同一组属性：Native Bash 外层携带 `data-tool="bash"`，Bash 卡与 skill 行在可展开时携带 `data-disclosure-row`。

`open-in-app-ssh` 是播种型范例：改为 Native 启动、播种共享夹具、断言空目录，并比对重新录制的 Native header golden。`message-actions` 是 Host 路由型范例：转录断言留在页面上，而分支点、子 Session id 与子 Session 继承的前缀来自 `session/history` 与 `session/fork`。

`launchNativeWeb` 还接受 `drop`，在 `keep` 过滤之前移除已发布的行。回放回合需要它替换已发布的 `pi-ai` provider：该行与回放行都提供 `model`，运行时会拒绝重复提供者。`native-replay-turn` 端到端验证了这条缝：`session/create`、用录制夹具调用 `session/prompt`，随后已发布的转录渲染出回放答案。

## Native 界面事实

这些与 Cordis 面不同，决定场景选择器如何迁移：

- Native 转录容器是 `div[class*="ChatPresentation_transcript"]`。`[data-chat-flow]` 属于 `ui-chat`，Native 应用没有挂载它。
- Native 输入框是 `textarea[aria-label="Message"]`。`[data-composer-input]`、`[data-input-scroll]`、`[data-turn-process]` 属于 `ui-conversation`/`ui-chat`，在 Native 没有对应物；Native 客户端把推理与上下文行直接内联渲染，不折叠进轮次过程。
- Native 复用共享的审批、提问与计划评审卡片，因此 `[data-approval-key]`、`[data-question-key]`、`[data-plan-review-key]` 在两个面上指向同一批元素。
- 侧栏行是 `[role="tree"]`（标签 `Workspaces`）下扁平的 `[role="treeitem"]`；Workspace 分组与 `Ungrouped` 也是行，而不是行的祖先。
- Native 转录在每个已结算 assistant 消息旁渲染 Copy 与已注册的消息动作。它没有分支动作，侧栏行菜单只有 Archive 与 Delete。
- `session/fork` 生成的子 Session 不进入源 Workspace 账目，因此列在 `Ungrouped` 下；冷打开该子 Session 时，路由从持久化的 `parentSession` 解析出它的根路由，所以选中其行会显示它自己的转录。
- `/` 面板只把选中的命令名补全进草稿，从不提交。提交的行若其名称能在该 Session 目录中解析，就作为 Host 命令执行；其余文本一律作为 prompt。
- 命令生命周期行由持久的 `command/run`/`command/done` 配对渲染。空闲 Session 没有 follow 流，所以客户端在命令结算后回读一次历史，而不是渲染 RPC 结果。
- 留下待处理收件箱输入的斜杠命令（如 `/plan <task>`）会启动接纳该输入的根轮次。Host 为该轮次附带 follow 流，并在轮次的历史基线设定完成后才回应命令 RPC；客户端随后通过 `session/status` 接入。未启动轮次的命令让 Session 保持空闲。
- 审批卡在工具名下方显示待批准调用的命令或参数。卡片渲染在输入框上方，与浏览器面的位置一致。
- 命令目录读取被拒绝时，草稿保留在输入框并显示错误；斜杠行永远不会作为普通文本发给模型。
- Native `ToolCard` 把 `present` 路由到 `NativePresentRow`，把 `ask_user_question` 路由到 `NativeAskQuestionRow`；其余调用走 `NativeToolCard`，其共享 `ToolRow` 携带 `data-tool=<名称>`。专用行存在但未接入时，会渲染成通用 JSON 卡片。
- `native-silent-model` 只在保留行不含 `standard` 常设 preset 时才自行注册它；出厂模板现已包含该 preset，无条件注册会造成重复 provider。
- `launchNativeWeb` 把 `credentials` 写入夹具的凭据文档，把 `predecessor` 写成一代已发布的 V2，场景因此能驱动凭据接缝或经 Host 观察相邻迁移。
- 回放的 `paceMs` 是每个 chunk 的延迟，不是每次响应的延迟；一次录制的工具调用响应包含大量 chunk，超过几十的值会让轮次停驻数分钟。
- `replay.providers` 接受 provider 自有的 `retryPolicy`，场景因此可以固定重试耗尽行为，而不必配置 Native 重试行——后者的配置必须保持为空。
- 种子 Session 按保留行组合出的 prompt 恢复。全行 profile 会组合出 run-code 段，因此系统消息记录为 `Answer the user.` 的种子必须保留窄行集。
- 结算与 follow 是两个独立 RPC，轮次可能先结算、后取 follow 流。Host 会保留这类已结算轮次，直到 `follow` 接入或 Client 断开，并在 release 时移除；结算完成即删除会让并发到达的 follow 收到 HTTP 409。
- 浏览器 Client 把所有 JSON `/api` 响应多路复用到 `/api/connection/follow-bus` 上，因此检查 follow 基线的场景读取的是共享 NDJSON 下行里的 base64 `bytes` 帧，而不是每个 Session 各自的 `/api/native-session/follow` 响应。
- 不等待 baseline 的准入仍必须观察其 rejection；否则路由解析失败会表现为 unhandled rejection。
- 审批卡通过 `readCommittedEvents()` 读取待批准调用的文本。前缀不可读时省略该文本，而不是拒绝整个决定。
- Native 输入框保留 Queue/Steer 手势：繁忙时 Enter 使用配置的默认动作，Cmd/Ctrl+Enter 使用另一动作；工具栏提供 `Queue` 与 `Interject`。待处理行带 `Queued`/`Interjecting` 标签以及 `Edit pending message`、`Interject instead`、`Delete` 操作。
- Native 输入框在轮次运行中仍保持可用，因此输入框可编辑并不代表轮次已结算。转录 golden 必须等 Stop 座位退出、所有附件缩略图加载完成后才能读取记录。
- Native 没有待插话的 transcript 气泡，也没有「空草稿一次插话全部排队消息」的手势；待插话在轮次接纳前只显示在 `Pending messages` 行中。
- Native transcript 通过 `ChatPresentation_userBubble` 渲染每条用户消息，其文本节点与内层 span 都会命中精确文本定位；断言应统计气泡数量而不是文本节点。
- Native 模型编辑器发送它打开时那次文档读取中的命名空间 revision。页面在每条推送的失效通知上重读该文档，因此另一笔写入之后打开的编辑器携带该写入产生的 revision。
- Native 应用使用 RedSpark 调色板，因此 `--dsw-alias-link` 解析为品牌绯红（`#b91f3b`）；固定链接语言的场景应从页面读取该属性，而不是沿用 Cordis lane 的 DeepSeek 蓝。
- Native 首次引导是「欢迎确认 + 模型配置」两步，模型步只在没有任何活跃路由可服务请求时出现。它是整屏 portal，没有 dialog 角色；跳过状态存在浏览器存储里；由于 pi-ai 路由的 settings path 非空，设置 → 模型不为它渲染 setup 卡片。
- Native replay 适配器曾重复实现脚本流循环，并漏掉 hang sidecar 的 `readyFile`。两个适配器现共用 `replayEntry`，hang 条目因此会为 Native 测试写出标记文件。
- 出厂的 Native Web profile 在组合里写明三个权限预设（`read-only`、`workspace-write`、`danger-full-access`），与 Cordis base bundle 一致。缺少 `read-only` 条目时，Native 应用无法把 Session 交还给它启动时的沙箱模式。
- Native 的变更操作先向 Session 所有者请求，再由沙箱执行。只读模式下首个写入先获批、随后被拒，提权重试会再发起一次请求；场景必须把两次都答复掉。
- 取消 Native 轮次会把被放弃的部分从实时 transcript 移除，而持久 assistant 流仍保留它。
- Native transcript 没有 turn-error 行，也没有重试链：失败的轮次结算后不产生 transcript 消息，除非失败是传输错误——那时渲染客户端的 `ConversationError` 卡片。
- Native transcript 渲染了逐消息反馈动作行，但在已发布构建中激活评分既不弹对话框，也不发 Host 请求。

## 已退役场景

已没有任何 `snapshots/web/` 目录选择 `profile: web`：十六个清单改到 `native-web`，十六个退役，`seeded-history` 作为共享夹具的所有者继续带着它的录制 Session 文件。

同样改到 `launchNativeWeb` 的还有：`approval-composer`、`feedback-command`、`message-actions`、`message-feedback-protocol`、`open-in-app-ssh`、`plan-review`、`present-svg`、`preset-migration`、`pwsh-terminal`、`question-composer`、`steering` 与 `web-search-round`。

已迁移到 Native 测试：

- `permission-policy-context` 通过输入框控件切换全部三种常设策略，并在共享审批卡上回答提权请求。
- `feedback-release` 驱动 `/feedback` 与 `feedback/message-*` Host 路由，并比对采集器收到的已授权前缀。逐消息评分对话框被绕过：在本构建中点击评分既没有弹出对话框，也没有发出 Host 请求，因此判定改走对话框本应提交的同一条路由。
- `fresh-round-trip` 保留录制 prompt、真实 Bash 调用与已结算转录。Cordis 的轮次过程折叠、系统提示扩展和 `RSH_WEB_URL` 探测随浏览器部署一并退役。
- `live-interactions` 从持久日志覆盖取消（hang sidecar）、AUTH 失败、重试恢复与重试耗尽。Native 转录没有轮次错误行、重试链，也不会保留被放弃的部分输出，因此这些断言改为读取规范事件。
- `models-settings-recovery` 让漂移的 `openrouter` 路由与健康提供方并存，添加 `minimax-cn`，拒绝仍点名未知模型的编辑，并删除过时模型。
- `clickable-links-gallery` 保留链接密集的正文轮次（Markdown、引用式、mailto、行内代码 URL、惰性对照、脚注）以及网页搜索与抓取行，并断言计算后的链接语言。写入推导的 chips、文件提及按钮与工具行文件链接随 Cordis 面退役：Native 没有这些表面。
- `onboarding-usable-provider` 跳过模型步，经设置 → 模型配置 `minimax-cn`，随后清除已存的跳过状态并重载：另一条可用路由结束提示，DeepSeek 保持为一行。

以下场景记为阻塞退役，其 `profile: web` 清单与 golden 一并移除：

- `background-job-list`：Native 应用未挂载 `NativeJobListAction`，Host 也没有取消 Job 的路由。
- `subagent-conversation`、`subagent-interrupt`：Native 侧栏没有子 Session 树，转录也没有被寻址的对话视图。
- `workspace-management`：Native 客户端没有 Workspace 的重命名、删除、扁平列表、悬停卡片与归档手势。
- `document-preview`、`navigation-panes`、`details-session-lifecycle`、`sidebar-scrollbar`：Native 应用没有右侧文档面板、轨迹面板、按 Session 的侧栏与会话列表滚动条槽。
- `file-upload-round`：Native 输入框只接受图片。
- `turn-tail-actions`、`goal-multi-turn-actions`：Native 转录没有轮次过程折叠、Compact/Normal 切换、用量展开与分支动作；已结算消息的动作由 `native-message-actions` 覆盖。
- `queued-image`、`plan-narrow-viewport`：它们属于 `queue-image.e2e.ts` 与 `plan-control-row.e2e.ts`，这两个文件的其余断言读取 `ctx`。
- `steering` 的「空草稿 Cmd+Enter 插话全部排队消息」在 Native 没有对应手势；其余两条 steering 路径已迁移。
- `queue-actions`：新的显式 prompt 不会推进已保留的 next-turn 队列。停止后的轮次保留排队消息，唤醒 prompt 单独运行，队列仍待处理；Cordis 循环会在该 prompt 之前排空队列。

`seeded-history` 退役了 golden，但保留 `session.v2.jsonl` 与 `session.v3.jsonl`：这条录制的 Session 正是 `native-message-actions` 与 `native-open-in-app-ssh` 复用的种子。它的轮次过程折叠、右侧预览与进程内上下文追加在 Native 没有对应物。

`bash-abort-row` 现在自己拥有录制的 Session 而不再借自己，并把组合声明为 `web-default` 而不是已退役的 `acp-default`。`web-default` 的 header pin 及其 prompt/schema sidecar 由 `seeded-history` 承担：录制会话语料要求每个 composition class 恰有一个 pinned 代表，而把 pin 留在 `fresh-round-trip` 会迫使一个已不再比对它们的 Native 测试继续携带 prompt/schema golden。

`lifecycle-chrome` 断言的是 Cordis 外壳：`centerCol`/`footArea` 几何、Kitsune hero、Lexical 输入框阶段、轮次过程里的缓存命中徽标，以及重连药丸。Native 外壳没有这些节点；它的模型选择、主题与语言路径由 `native-conversation` 覆盖，计划模式由 `native-question-cancel` 覆盖。

## 后续

删除 `rsh-web-app`、`rsh-base`、`gateway` 与 `remotes` 也会删除 `launchWebScaffold`，而 `rsh/Programs/Web/application/tests/` 中仍有 23 个文件导入它，另加 `scaffold.ts` 自身、`stress-tests/reasoning-chunks.stress.ts` 与 `rsh/Tests/benchmarks/long-session-browser/long-session.bench.ts`。这些是共享客户端呈现与 Host 集成场景，而不是本次退役的录制会话场景：滚动、输入框几何、设置、引导，以及出厂组合探测。它们必须先迁移——迁到 `native-browser-graph.spec.ts` 使用的固定连接层，或在需要真实 Host 时迁到 `launchNativeWeb`。压力用例与基准需要各自的 Native 启动路径或退役。因此这些包与该脚手架应在后续变更中一起删除。

最初导入它的 52 个测试各自只属于以下三组之一。五个重复项与二十个退役阻塞中的十六个已删除，「以 Native 测试迁移」下列出的场景已运行在 Native 上；仍有 23 个测试文件导入该脚手架。

- **已删除（5 个）：** `bash-abort-row`、`minimal-preset.snapshot`、`ptc-round`、`skill-tool-row`、`scaffold-hermetic`。前四个已有通过的 `native-*` 对照；`scaffold-hermetic` 只验证 Cordis 脚手架自身的隔离，随脚手架一起删除。
- **迁到 Native（剩 19 个）：** `agent-preset-authoring`、`agent-preset-selection`、`chat-continuous-conversation`、`chat-long-interactions`、`chat-scroll-contract`、`declared-reasoning`、`default-model`、`models-settings`、`onboarding-deepseek-config`、`plugin-config`、`present`、`schedule-after`、`settings-chrome`、`skill-user-invoke`、`startup-auto-selection`、`streaming-fence-highlight`、`trajectory-virtualization`、`workflow-run`、`workspace-new-session-folding`。`markdown-cjk-strong`、`markdown-images`、`markdown-inline-code-links`、`math-rendering` 与 `rail-search-expand` 已作为 `native-*` 对照运行。每个剩余断言面在 Native 侧都已存在：预设设置节、模型与推理选择器、转录及其 markdown 渲染器、已声明文件行、侧栏搜索、日程目录、设置分节、注入行、轨迹面板与工作流行。点名 Cordis 专有节点的断言（`data-chat-flow-*`、`data-composer-input`、`data-turn-process`、右侧栏、dockkit）改到 Native 节点，或随浏览器外壳一起退役。
- **记为退役阻塞（20 个，已删 16 个）：** `sidebar-right`、`sidebar-subagent-activity`、`message-feedback`、`remote-welcome`、`stats-paged-history`、`startup-rpc-budget`、`github-ready-review`、`composer-draft-scroll`、`composer-placeholder`、`composer-tab-geometry`、`markdown-wide-table`、`reference-composer`、`skill-invocation-policy`、`access-confirmation`、`produced-files`、`produced-file-mentions`、`goal-bar`、`goal-command-presentation`、`shipped-composition`、`complex-history.perf`。Native 没有右侧栏或 dockkit 面板，没有子会话树，没有可用的逐消息评分对话框，而非回环提示属于已退役的浏览器部署。Native 转录只显示逐消息 token，不提供全量会话统计行，也不暴露 `sessionStats` 投影；Cordis 客户端的冷启动 `settings/describe` 预算同样不描述 Native 启动路径。Native 的 GitHub 入口共享选定的监听器，不挂载隔离入口端口；签名投递经可信规则处理由 `native-github-webhook.snapshot.ts` 覆盖。六个呈现场景断言的是 Lexical 输入框、其 chip，以及 Cordis 转录与框体几何。它们的归属随浏览器客户端退役；Native 输入框是普通 textarea，有自己的高度上限与 HTML 占位符，Native 布局断言需要自己的测试，而不是移植这些文件。`access-confirmation` 断言 Cordis 的风险对话框、确认复选框和权限触发器的 `aria-label`；Native 立即应用权限预设，没有页内确认，也没有标注当前值的标签。`produced-files` 读取由写入推导的摘要及其前缀预算和 `+N files` 余量；Native 只渲染 `deliverables/presented` 声明，因此只有写入的轮次在 Native 没有对应行。`produced-file-mentions` 依赖 Cordis 的文件提及词表，将唯一的行内代码 basename 链接到侧栏预览；Native 转录不传入该词表，因此所有提及都保持为不可交互的代码。`goal-bar` 驱动暂停、恢复与清除；Native 目标条是只读的，只显示阶段、目标与轮次进度，没有操作。`goal-command-presentation` 断言人类命令输入气泡、其 chip 与排版；Native 命令行只渲染命令名与结算结果。`shipped-composition` 描述的是已不再出厂的 Web 组合——Native 行与其配置由 `native-profile-template.spec.ts` 覆盖——而 `complex-history.perf` 是该客户端的可选基数基准；Native 性能工作需要自己的清单。只有前四个仍有测试文件。

五个重复项已删除。接下来是设置、引导与预设迁移，然后是转录、滚动与工作流组，之后处理四个记录在案的阻塞，最后删包与脚手架。

## Alternatives considered

**以同一接口把 `launchWebScaffold` 移植到 Native。** 暂不采纳。它的 `ctx` 正是 25 个场景断言所用的 Cordis 根，Native 实现能通过类型却会在运行时让这些断言全部失败。

**把其余 `profile: web` 场景全部记为阻塞并立刻退役 lane。** 不采纳。记录的阻塞用于能力确实不存在；其中大多数已有 Native 归属，只缺测试。

**保留逐文件引导。** 不采纳。重复正是两处契约失配未被发现的原因：每个文件各自推导它恰好查询的客户端预期。

## Acceptance criteria

- 没有任何 `snapshots/web/` 目录再选择 `profile: web`；每个迁移场景在 `RSH_SNAPSHOT=replay` 下通过，并断言 `assertFixtureInventory(..., 'native-web')`。
- 后续完成后，`launchNativeWeb` 是 `profile: native-web` 场景唯一使用的脚手架。在此之前有五个目录仍由两处消费：Native 测试持有清单，Cordis 测试继续比对各自的 golden 或复用已录 Session（`message-feedback-protocol`、`present`、`schedule-catalog`、`seeded-history`、`workflow-run`）。
- `rsh-web-app`、`rsh-base`、`gateway` 与 `remotes` 与 `launchWebScaffold` 一起删除，时间点在 `## 后续` 中剩余场景迁移完成之后。

## Risks

- 迁移后的 golden 是重新录制的，记录的是该提交下 Native 客户端的实际渲染。每次刷新都要读 diff，而不只是看绿灯。
- 斜杠命令在无轮次的情况下结算，其行只在客户端回读历史后出现；断言该行却没有这次回读的场景会看到未变化的转录。
- 客户端在 Host 发布活跃根 owner 之前接入命令启动的轮次会被路由捕获拒绝。Host 把命令 RPC 保持到轮次历史基线设定完成，接入总能找到该 owner。
- 工作区行出现时连接视图仍在恢复；输入框离开待处理输入模式之前按下 Enter 会把文本作为插话输入排队，而不是运行命令行。
- `session/fork` 生成的子 Session 不进入源 Workspace 账目，也无法从侧栏打开；依赖 fork 后续界面的断言需要先补齐这条路径。
