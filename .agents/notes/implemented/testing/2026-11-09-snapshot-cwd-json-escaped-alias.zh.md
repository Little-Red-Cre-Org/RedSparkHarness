# Agent Note: 会话快照中 JSON 转义的 cwd 写法归一化

Status: implemented

[English](2026-11-09-snapshot-cwd-json-escaped-alias.md) | 中文

## Problem

录制下来的运行时上下文快照以内嵌 JSON 字符串的形式携带沙箱工作区根目录，因为策略文本用 `JSON.stringify` 陈述该路径。在 Windows 上，该片段里的每个分隔符都被序列化成双反斜杠，于是工作区在日志中的写法与 Session 头部 `cwd` 不同。headless 会话套件只对头部写法做了 token 化，因此 `session-sandbox-root` 与 `web-fetch` 会把真实的 Windows 路径与录制中的 `{{cwd}}` token 相比，并在任何把工作区分配在含反斜杠路径之上的平台上失败。

## Decision

`snapshots/session/headless.snapshot.ts` 的 `contextOf` 以 `NormalizeContext.cwdAliases` 条目提供本次运行 cwd 的 JSON 转义写法：`JSON.stringify(cwd).slice(1, -1)`。既有的最长优先别名替换随后会 token 化这两种写法。`rsh/Programs/CLI/tests/profiles/headless/tests/` 下的四个 headless profile e2e 所有者出于同样的原因已经传入该别名；会话快照所有者现在与它们一致。

该别名是写法，而不是等价判定。在 POSIX cwd 上，转义写法与普通写法相同，条目会归并为一个 token，不产生任何变化；在 Windows 上，它恰好补上策略文本所产生的那一种表示。

## Alternatives considered

**不用 `JSON.stringify` 渲染策略文本。** 那会为了修复一个比较缺陷而改掉每个平台上模型可见的运行时上下文文本，并使记录加引号形式的已提交 fixture 失效。

**让规范化器全局反转义反斜杠。** 全局改写还会破坏正则、shell 命令以及本身合法包含双反斜杠的模型撰写文本；而且规范化器已经把分隔符处理限定在已识别的路径位置上。

**录制平台专属的写入方 fixture。** 该场景观察的是真实的策略快照，而不是某种平台观点，并且已提交的代际必须能在 macOS 与 Linux 上重放。

## Consequences

会话套件现在会 token 化沙箱策略段落内部的工作区，`session-sandbox-root` 在 Windows 上无需改动其 fixture 或其 `/tmp` 配置即可通过。该改动消除了套件中两个本地 Windows 失败，其余失败仍各自归因于自身原因：平台选择的 shell 工具、落后于源码的 fixture、随 `cordis` preset 一起删除的 skill 路径、未命中的重放占位符，以及一处路径拼接缺陷。

别名列表仍作为每个所有者的输入，而不是规范化器的默认值。以其他序列化形式内嵌路径的生产者，必须在其知道运行 cwd 的地方声明该写法；规范化器无法推断哪些片段是路径。
