# Agent Note: Cordis 回放在 Native 回放通过后停止

Status: implemented

[English](2026-11-14-cordis-replay-stops-when-native-passes.md) | 中文

## Problem

`snapshots/session/headless.snapshot.ts` 选中每个 `profile` 为 `legacy-headless` 的 `snapshots/session/*/snapshot.yml`，并用 `dsh --profile legacy-headless` 启动它。这些目录里的大多数已经有同一份 fixture 的 Native 回放。删掉目录会删掉 Native 测试所读的 fixture。只改一个 composition 成员、让它的 `cordis.yml` 所有者继续被选中，或者反过来，都会让启动器抛出 `composition has no cordis.yml owner`。

## Decision

一个 composition 只有在全体成员一起离开、且每个成员的 Native 回放文件都通过之后，才离开 Cordis 启动器。离开的含义是 `profile` 字段为 `headless`。`rsh/Scripts/session-snapshot-corpus.corpus.ts` 已经允许 `snapshots/session/` 下使用 `headless`。fixture 目录、`cordis.yml` 和 Native 测试路径保持不动。

80 个目录是 `headless`。`profile` 字段是清单。`ptc-python` 在回放通过后离开。该回放只在隔离场景里挂载 `@redspark/rsh-experimental-code-runtime-python`。已发布 profile 仍不得点名它。`product-subagent-result-diagnostic` 在回放通过后离开。该回放使用 stub 外部驱动和归 Agent 所有的 job，不启动产品子进程。工具配置不得传入 `provider`，除非驱动声明了该路由字段。`subagent-acp-diagnostic` 在回放通过后离开。工具名是 `subagent_acp`。stub 驱动以 `stopReason: aborted` 返回已录制的 diagnostic；该场景不启动 ACP 子进程。`session-query` 在回放通过后离开。已发布的 `headless` 提供 `sessionQuery`，不安装查询工具。隔离场景补上 `session-projection` 与 `tool-session-query`。录制调用读取 seq 10。Native 不记录 `permission/preset`、`sandbox/mode` 与 `approval/policy`，所以同一请求头是 seq 7。回放复制共享 override，只改第一个 seq。共享文件仍服务 Cordis 场景。适配器配置把 `contextWindow` 设为 `1000000`。

## Remaining legacy-headless replays

6 个目录仍是 `legacy-headless`。

`advanced` 留下。`cordis-inspect-jsdoc` 拥有该 composition，并演练 `@redspark/rsh-tool-cordis` 的 `cordis_define`、`cordis_undefine` 与 `cordis_inspect_query`，该包没有 Native 入口。已记录的动作是该包删除时一并删除 `advanced-toolchain`、`advanced-toolchain-runtime` 与 `cordis-inspect-jsdoc`，而不是写 Native 回放。见 [还有谁依赖 Cordis](../../proposed/architecture/2026-11-10-what-still-depends-on-cordis.zh.md)。

`pwsh-tool-turn` 留下，因为这台主机没有 `pwsh`，Native 回放以 `spawn pwsh ENOENT` 失败。Cordis 启动器在这种情况下跳过 `platform: pwsh`，这次跳过不是 Native 覆盖。

这些目录没有 Native 回放文件：`advanced-toolchain`、`advanced-toolchain-runtime`、`cordis-inspect-jsdoc` 与 `persistent-pwsh-tool-turn`。`persistent-pwsh-tool-turn` 仍需重新录制，如 [把已录制的 Session 迁到 Native profile](../architecture/2026-11-10-moving-sessions-to-the-native-profile.zh.md) 所记。`subagent-published-run-failure` 留下，因为录制的父工具结果把运行错误和 dispose 错误接在一起，而 Native 前景运行调用 `subagents.run`，失败标题只有 `subagent run failed`（`rsh/Engine/subagent/tool-subagent/src/native.ts:29`）。这一刀不加环境钩子去逼出录制文本。`legacy-acp` 和 `web` 仍在 headless 清单之外。SDK 启动器按下面同一条全体离开规则处理。

## SDK 启动器

`snapshots/sdk/sdk.snapshot.ts` 选中 `profile: legacy-sdk`，并用 `dsh --profile legacy-sdk` 启动。语料闸门允许 `snapshots/sdk/` 下使用 `sdk`。一个 composition 只有在全体成员一起离开、且同一份 fixture 的 Native 回放通过之后，才离开该启动器。回放不要求持久日志逐条相等：Native 不记录 `permission/preset`、`sandbox/mode` 与 `approval/policy`。

`sdk-upload` 已离开。它唯一的成员是 `snapshots/sdk/text-turn`。`snapshots/native-sdk/legacy-text-turn.snapshot.ts` 启动已发布的 `sdk` profile，发送录制的用户文本，并断言录制的助手文本和已完成的 `turn/end`。录制的 `feedback/*` 事件来自 `snapshot-message-feedback` 与 `./feedback-producer.mjs`，`cordis.yml` 只在 `RSH_SNAPSHOT_FEEDBACK` 为 `1` 时启用它们。已发布 profile 不安装这些插件，所以回放不断言该序列。线级黄金文件留在 fixture 目录里。

`session-title` 已离开。它唯一的成员是 `snapshots/sdk/session-title-after-turn`。已发布的 `sdk` profile 不安装会话标题；只有 `native-web` 和 `native-tui` 安装（`rsh/Programs/CLI/src/native-profile-template.ts:393`）。`snapshots/native-sdk/legacy-session-title.snapshot.ts` 把 `@redspark/rsh-session-title` 和 `@redspark/rsh-session-title-first-prompt-llm` 追加到该组合，与 fixture 的 `cordis.yml` 插入的两个插件相同。mock 用 `Late durable session title` 回答标题系统提示，用 `TITLE_DONE` 回答录制任务。晚到的标题是后台工作，所以断言在 `turn/end` 之后读取持久化的 `session.v3.jsonl`。回放断言回退标题、`session/title-llm-request`、provider 标题、助手文本和已完成的回合。它不要求 Cordis overlay 路由 `title-replay` / `title-model`。

`image` 已离开。它唯一的成员是 `snapshots/sdk/inline-image-prompt`。这份 fixture 没有 `cordis.yml`。`snapshots/native-sdk/legacy-inline-image.snapshot.ts` 启动已发布的 `sdk` profile，发送录制的文本、图像、文本块。夹具模型声明 `input: ['text', 'image']`。mock 只在两段文本和 `data:image/png;base64,` 加录制字节都出现时接受请求，然后返回 `DONE`。录制的回退 `session/title` 来自 Cordis SDK 基础 bundle，这个 composition 没有插入它；已发布的 `sdk` profile 不安装会话标题，所以回放不断言该标题。

`system-prompt-in-history` 已离开。它唯一的成员是 `snapshots/sdk/system-prompt-in-history`。fixture 的 `cordis.yml` 插入 `in-history-prompt-update`，在第一次成功的 `read` 之后写入 `Snapshot guidance added after the first read`。`snapshots/native-sdk/legacy-system-prompt.snapshot.ts` 写出已发布的 `sdk` 组合，把 `pi-ai` 换成 replay provider，使模型声明 `systemPromptUpdate: 'in-history'`，并追加 `@redspark/rsh-fs-observation-policy`、`@redspark/rsh-tool-fs` 和同一个本地插件。已发布 profile 没有文件工具，且 `pi-ai` 不转发 `systemPromptUpdate`（`rsh/Modules/Official/llm/llm-pi-ai/src/adapter.ts:688`）。回放断言两条追加的 `system/message`，第二条含指导句且位于 `tool/result` 之后，一次 `read`，一条 `request/header`，以及 `DONE`。Native 的 `request/context` 只记录 provider、model 与 context window（`rsh/Engine/core/native-headless/src/native.ts:1827`），所以回放不在那里断言 `systemPromptUpdate`。

`ptc` 已离开。它唯一的成员是 `snapshots/sdk/ptc-turn`。fixture 的 `runtime.cordis.yml` 插入 `@redspark/rsh-code-runtime-worker-thread`。`snapshots/native-sdk/legacy-ptc-turn.snapshot.ts` 写出已发布的 `sdk` 组合，把 `pi-ai` 换成 replay provider，停用 `persistent-bash`，并追加 `@redspark/rsh-bash-local`、`@redspark/rsh-shell-env`、`@redspark/rsh-tool-bash`、`@redspark/rsh-native-code-runtime` 与 `@redspark/rsh-tool-code-runtime`。已发布 profile 的 bash 工具是持久 shell，两个工具都注册为 `bash`；录制程序读取的是一次性工具的 `stdout.text`。回放断言一次 `run_code`，两次 `bash` 分发（`echo CODE_ONE`、`echo CODE_TWO`），工具结果含 `CODE_ONE+CODE_TWO`，以及该最终回复。已发布 profile 仍然不挂载 code runtime。

`sdk-minimal` 已离开。它唯一的成员是 `snapshots/sdk/persistent-tools`。`@redspark/rsh-tool-str-replace-editor` 没有 Native 入口。`snapshots/native-sdk/legacy-persistent-tools.snapshot.ts` 写出已发布的 `sdk` 组合，把 `pi-ai` 换成 replay provider，在 fixture 副本里替换 `{{cwd}}`，并追加一个只存在于该回放的 `str_replace_editor`。该本地插件接受录制里的 null 占位，并在 workspace 上执行 create、view 与 str_replace。bash 调用走已发布的持久 shell。回放断言 `/tmp` 上 `COUNT=1` 再 `COUNT=2`、`delayed`、`[shell exited: code 9]`、重置说明、`note.txt` 与 `workspace.expected/note.txt` 一致，以及 `PERSISTENT_TOOLS_OK`。

`sdk-default` 已离开。它的成员是 `snapshots/sdk/bash-tool` 与 `snapshots/sdk/subagent-spawn-in-process`。`snapshots/native-sdk/legacy-bash-tool.snapshot.ts` 写出已发布的 `sdk` 组合，把 `pi-ai` 换成 replay provider，停用 `persistent-bash`，并追加 `@redspark/rsh-bash-local`、`@redspark/rsh-shell-env` 与 `@redspark/rsh-tool-bash`。录制调用带 `description`，已发布的持久 shell 不声明该字段。回放断言一次 `bash`、stdout `dsh-sdk-proof-7391`，以及该最终回复。`snapshots/native-sdk/legacy-subagent-spawn.snapshot.ts` 把录制的子会话日志作为 `childFiles`。该子会话没有脚本化的模型条目，以 `llm-replay: script exhausted` 结束；父工具结果是 `Error: subagent run failed`，助手仍回复 `child answer 42.`。回放断言该回复和一次 `subagent` 调用。它不要求 Cordis 的错误文本。

`default` 留下。它的成员是 `snapshots/sdk/max-tokens-continue`、`snapshots/sdk/multi-turn`、`snapshots/sdk/subagent-fork-in-process`、`snapshots/sdk/subagent-list-agents` 与 `snapshots/sdk/subagent-mixed`。`snapshots/native-sdk/legacy-max-tokens.snapshot.ts`、`snapshots/native-sdk/legacy-subagent-fork.snapshot.ts` 与 `snapshots/native-sdk/legacy-subagent-mixed.snapshot.ts` 已通过。`multi-turn` 没有 `session.v3.jsonl`。`subagent-list-agents` 在当前产品上不能离开：录制的父会话在子会话仍可列出时收到 `subagent-settled`，而 Native 只在 continuable activation 关闭时投递这条消息。

`subagent-continuable`、`subagent-continuable-inheritance` 与 `subagent-send-message` 因同一结算缺口留下。`subagent-rsh-sdk-dynamic-route` 留下，因为录制的子路由是 `mock/mock-routed/max/777`；回显诊断的桩不能证明 SDK 子进程收到了该路由。`@redspark/rsh-subagent-rsh-sdk` 仍然没有已发布 `sdk` profile 可挂载的 Native 入口。

`sdk-dsh-sdk-diagnostic` 已离开。它唯一的成员是 `snapshots/sdk/subagent-rsh-sdk-diagnostic`。`snapshots/native-sdk/legacy-dsh-sdk-diagnostic.snapshot.ts` 写出已发布的 `sdk` 组合，把 `pi-ai` 换成 replay provider，把 `subagents` 的 `providerName` 设为 `snapshot-dsh-sdk`，并停用 `workflow-worker`、`workflow-tool`、`ralph-tool` 与 `subagent-tool-fork`。这些工作流行会在激活时拒绝不是 `spawn` 的 provider 名，fork 行则要求进程内的已完成回合种子。回放追加一个只存在于该场景的 `externalSubagentDriver`，以及两个名为 `subagent_dsh_sdk` 与 `subagent_dsh_sdk_background` 的 `@redspark/rsh-tool-subagent` 行。该驱动不启动子进程。回放断言这三个工具名、录制的诊断文本、`partial child loader answer`、`PARENT_OBSERVED_DSH_SDK_DIAGNOSTIC`，以及已完成的回合。

`legacy-acp` 留下。`image-compaction` 通过 DeepSeek 路由给六张图计价，并把 `retainTokens` 设为 100；无 key 的 `pi-ai` fixture 不计价，`@redspark/rsh-llm-deepseek` 又要求凭证。`acp-default` 留下，因为 `reject-extra-dirs` 录制 `Invalid params: additionalDirectories is not supported`，而已发布 profile 接受该字段。`snapshots/native-acp/legacy-handshake.snapshot.ts` 在已发布 profile 上回放 initialize 与 `session/new`。录制的代理名是 `redspark-harness-acp`，`promptCapabilities.image` 为 false；已发布 profile 报告 `redspark-harness-native-acp` 并声明支持图像。`session/new` 仍返回录制的模型值 `["deepseek-official","deepseek-v4-flash"]`。

`native-web-session-core` 离开了 `web` 清单。它的成员是 `snapshots/web/native-session-core` 与 `snapshots/web/native-feedback`。`snapshots/web/native-session-core.snapshot.ts` 启动 `dsh --profile native-web` 并且已通过。`native-feedback` 本来就是 `profile: native-web`。`native-conversation`、`native-question-cancel` 与 `native-session-grant` 各自拥有一个单成员 composition。它们的 e2e 启动 `dsh --profile native-web`，并不调用 `assertFixtureInventory`，且已通过，所以这三个目录现在是 `profile: native-web`。侧栏语言按钮只改当前页的语言；重载后回到浏览器语言，对话 e2e 接受这一点。其余留下的 `web` 目录由调用 `assertFixtureInventory` 的 Playwright 测试选中（`rsh/Programs/Web/application/tests/scaffold.ts:1551`），该检查要求 `profile: web`。`bash-abort-row` 是 `acp-default` 唯一的 web 成员。`rsh/Programs/Web/application/tests/native-bash-abort-row.e2e.ts` 启动 `dsh --profile native-web` 并且已通过，所以该目录现在是 `profile: native-web`。Native 行是 `[data-tool=bash]`，不是 `[data-sample=bash]`。种子把夹具的 system 消息从 `{{system}}` 改写成 profile 的提示词，因为恢复会话会拒绝与配置不一致的已存提示词。`rsh/Programs/Web/application/tests/bash-abort-row.e2e.ts` 仍比对 Cordis 的 `ui.expected.md`，并且现在期望 `native-web`。`rsh/Programs/Web/application/tests/native-skill-tool-row.e2e.ts` 启动 `dsh --profile native-web` 并且已通过。Native 转录用 `GenericToolCard` 渲染这次播种的调用，不是 Cordis 的 `SkillRow`。`rsh/Programs/Web/application/tests/native-workflow-open.e2e.ts` 启动 `dsh --profile native-web` 并且已通过。Open 使用 `navigableWorkflowMembers`。选中仍在运行的子会话时，Host 返回锁定的模式控件，不占用 root 准入（`rsh/Programs/Web/api/native-web-session-controller/src/native.ts`）。`skill-tool-row` 与 `workflow-run` 是 `default` 的 web 成员，所以这两个目录现在是 `profile: native-web`。它们的 Cordis e2e 仍比对 Cordis golden，并且现在期望 `native-web`。`minimal-preset` 离开了。`rsh/Programs/Web/application/tests/native-minimal-preset.e2e.ts` 启动已发布的 `native-web`，回放 `snapshots/web/minimal-preset/session.v3.jsonl`，并且已通过。常备 Minimal 行把提示词固定成 `You are a helpful software engineer assistant.`，只保留一个持久 shell，并且不做压缩。作用域允许列表还会隐藏内置工具和之后注册到该作用域的工具，所以模型只看见 `bash`。Cordis e2e 仍比对原有 golden，并且现在期望 `native-web`。`web-schedule` 离开了。它唯一的成员是 `snapshots/web/schedule-catalog`，`rsh/Programs/Web/application/tests/native-schedule-catalog.e2e.ts` 启动 `dsh --profile native-web` 并且已通过。Native 目录折叠选中 Session 已读到的 `schedule/change` 事件，并与 `scheduler.listSchedules()` 行合并，所以只播种夹具就足够。种子通过已附加 owner 删除记录，侧栏标记沿同一份 Host 历史折叠加变化。`rsh/Programs/Web/application/tests/schedule-after.e2e.ts` 仍比对 Cordis golden `catalog.expected.md`，并且现在期望 `native-web`。布局数字仍只属于 Cordis。`web-ptc` 离开了。它的成员是 `present` 与 `ptc-round`。`rsh/Programs/Web/application/tests/native-present.e2e.ts` 启动 `dsh --profile native-web`，折叠 Session 的 `deliverables/presented` 记录，并通过 `/api/present.open` 打开文件；`rsh/Programs/Web/application/tests/native-ptc-round.e2e.ts` 渲染 `run_code` 父行及嵌套 Bash 终端。两者都已通过，所以这两个目录现在是 `profile: native-web`。`web-default` 作为同一个 composition 留下。它的多数 e2e 调用 `scaffold.ctx`。只播种的显示测试仍断言 Cordis 界面：`Chat` 标签、`[data-sample=bash]`，以及侧栏几何。`preset-migration` 由 `rsh/Programs/Web/application/tests/preset-migration.snapshot.ts` 选中，不是无主目录。33 个 `snapshots/web/` 目录仍是 `profile: web`。

9 个 `snapshots/sdk/` 目录仍是 `legacy-sdk`。

## Alternatives considered

**一旦存在 Native 文件就删除 fixture 目录。** 否决。Native 测试读取 `snapshots/session/<name>/`，语料闸门也要求那个 `snapshot.yml`。

**在 `headless.snapshot.ts` 里按名字跳过，并保持 `profile: legacy-headless`。** 否决。语料闸门已经检查 profile 字段。第二份跳过清单会与决定选择的那个字段脱节。

**在 `skill-load` 仍在时搬走 `text-turn`。** 否决。`text-turn` 是唯一的 `default` composition 所有者。启动器要求这个所有者出现在它仍然选中的场景里。

## Consequences

Cordis 启动器选中 6 个 `legacy-headless` 目录，而不是 86 个。这 80 个的覆盖是字段改动之前已经通过的 Native 回放。以后的 composition 按同一条规则离开。当时没有 key，所以没有 Native 文件的目录没有重新录制。
