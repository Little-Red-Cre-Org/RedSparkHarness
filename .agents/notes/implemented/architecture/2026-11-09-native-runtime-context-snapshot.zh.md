# Agent Note: Native 将常驻策略组合进运行时上下文快照

Status: implemented

[English](2026-11-09-native-runtime-context-snapshot.md) | 中文

## Problem

Cordis 会话到达模型时携带一条 `user/message` 运行时上下文快照，陈述常驻的文件策略与审批策略。这条快照的作用是避免模型仅凭策略文本就预判拒绝、从而放弃本可完成的工作；它也是录制一轮对话时紧跟用户消息之后的那个表面节点。

`native-headless` 没有这条消息。`native-sandbox-policy` 解析出的策略确实由文件与代码工具执行，`native-approval` 也确实在受保护操作前应用其策略，但两者都没有作为上下文到达模型。因此 Native 会话运行在一条模型读不到的策略之下，其录制的 Session 也没有 Cordis 那边存在的快照。

## Decision

`runTurn` 通过 `this.sandboxPolicy?.resolve({ session })` 解析常驻策略；该服务安装时，用 `policySections` 渲染一条 `user/message`：`sandbox:policy` 段陈述解析后的模式，在 `workspace-write` 下并陈述工作区根目录；`approval:policy` 段陈述 `ask` 约定或审批已禁用的约定。该消息的来源为 `{ kind: 'plugin', plugin: '@redspark/rsh-system-prompt', form: 'snapshot', sections }`，文本前缀与 `joinContextSections` 生成的头部一致，因此录制的 Native 轮次与 Cordis 轮次以相同方式描述策略。

快照会与模型历史仍然保留的文本去重，而不是每步追加。`retainedRuntimeContext` 读取由本生产方拥有的最新存活表面节点；只有当渲染文本不同时才追加一步。这与 `agent-loop` 中 `RuntimeContextProjection.project` 对未变化快照不提交的行为一致，也使三步的一轮不会携带三份相同副本。

措辞逐字取自 Cordis 的所有者——`sandbox-policy` 中的 `renderPolicyContext` 与 `compat-user-approval` 中的 `approval:policy` 贡献——因为该文本是面向模型的约定，而不是 Native 的发明。

## Alternatives considered

**每一步都追加快照。** 否决。实现更简单，但录制的 Native 轮次会每步携带一份，而 Cordis 是每次策略变化一份。在已发布语料上实测，这会在 `claude-code` 产生 2 处新增、在 `fs-sandbox-tool-round` 产生 5 处，而语料记录的是相反情况。

**复用 Cordis 的 `systemPrompt` 上下文贡献。** 否决。该服务是 Cordis 插件；Native 应用不组合任何 Cordis Context，语料已通过一个在构造 Context 时抛错的加载器探针断言了这一点。

**只渲染 sandbox 段。** 否决。模型读不到的审批策略与读不到的文件策略是同一类缺陷：模型无法区分会被询问的操作与会被直接拒绝的操作。

**把工作区根目录排除在文本之外。** 否决。`workspace-write` 只有连同其授权根目录才有意义，而 Cordis 的文本也陈述了它。

## Consequences

Native 会话现在向模型提供与 Cordis 会话相同的常驻策略上下文，`snapshots/native-headless/` 也记录了它：五个场景获得该快照，`ptc-jobs` 获得两条，因为其策略在步骤之间确实从 `read-only` 变为 `danger-full-access`。

该快照以 JSON 字符串内嵌工作区根目录，因此这五个所有者现在传入 `cwdAliases: [JSON.stringify(workspace).slice(1, -1)]`，即会话套件在 [JSON 转义 cwd 笔记](../testing/2026-11-09-snapshot-cwd-json-escaped-alias.zh.md) 中采用的同一转义写法别名。缺少它，fixture 会记录每次运行随机的临时目录。

一个单元测试钉住了去重：同一未变化策略下的三个步骤只产生一条快照，而移除该守卫时测试会以三条失败。Native 应用仍然不组合 Cordis Context，`approval` 与 `sandboxPolicy` 仍是可选行——两者都未安装的 profile 不会追加任何快照。
