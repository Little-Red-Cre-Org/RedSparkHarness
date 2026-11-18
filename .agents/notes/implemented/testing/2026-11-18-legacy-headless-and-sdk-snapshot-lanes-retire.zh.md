# Agent Note：legacy headless 与 SDK 快照车道退役

Status: implemented

[English](2026-11-18-legacy-headless-and-sdk-snapshot-lanes-retire.md) | 中文

## 问题

两条 Cordis 快照车道都已经不再执行自己的成员。

`snapshots/session/headless.snapshot.ts` 只收集 `profile: legacy-headless` 的目录，随后用 `compositionOwners.get('default')` 取共享的模型脚本。`default` 的属主是 `snapshots/session/text-turn`，它在自己的 Native 重放通过后改成了 `profile: headless`。这张表只由该运行器收集到的目录构建，因此一直是空的：剩下六个用例里有五个在启动进程之前就抛 `headless corpus has no default composition`，第六个也没有断言任何东西。这条车道报的失败描述的是语料，不是产品。

`snapshots/sdk/sdk.snapshot.ts` 只收集一个用例 `subagent-continuable`。`snapshots/native-sdk/legacy-continuable.snapshot.ts` 已经用 `dsh --profile sdk` 重放同一个目录。

PR CI 只运行 `.github/workflows/redspark-ci.yml` 中逐个点名的快照文件，而这份清单从未包含该运行器；整条语料只在本地与 master 车道执行。因此一条什么都不执行的红色运行器可以一直不被发现。

## 决定

删除两条运行器。当 Native 重放会读取某个 fixture 目录时，该目录比它的 Cordis 运行器活得久，其 `snapshot.yml` 随后声明该重放使用的 profile。

`snapshots/session/headless.snapshot.ts` 与 `snapshots/sdk/sdk.snapshot.ts` 已删除，`rsh/Scripts/session-snapshot-corpus.corpus.ts` 不再列出它们，也不再接受 `snapshots/session/` 下的 `legacy-headless`。

各成员的去向：

| 目录 | 结果 |
|---|---|
| `session/advanced-toolchain`、`session/advanced-toolchain-runtime`、`session/cordis-inspect-jsdoc` | 删除。它们执行 `@redspark/rsh-tool-cordis` 提供的 `cordis_define`、`cordis_undefine` 与 `cordis_inspect_query`；[What still depends on Cordis](../../proposed/architecture/2026-11-10-what-still-depends-on-cordis.zh.md) 已记录该能力随包退役，而不是补一份 Native 重放。 |
| `session/pwsh-tool-turn` | 保留，作为 `snapshots/native-headless/pwsh-tool-turn-native.snapshot.ts` 的场景；`profile` 现为 `headless`。 |
| `session/persistent-pwsh-tool-turn` | 保留，`profile: headless`。目前没有 Native 重放读取它，fixture 留下来等待那一次重放，而不是随运行器一起消失。 |
| `session/subagent-published-run-failure` | 保留，`profile: headless`。它持有 `snapshots/sdk/subagent-continuable` 所 pin 的 `subagent-durability-failure` 组合与请求头类，而 Native 仍然不会产生录制中的 dispose 文本。 |
| `sdk/subagent-continuable` | 保留；`profile` 现为 `sdk`，即 `snapshots/native-sdk/legacy-continuable.snapshot.ts` 启动的 profile。 |

`legacy-acp` 是语料中仅剩的 legacy profile。它的八个用例构建 Cordis ACP 组合，需要先重建该组合才能迁移；`snapshots/acp/acp.snapshot.ts` 保持 `profile: legacy-acp` 不变。

## 后果

`legacy-headless` 与 `legacy-sdk` 仍留在可接受的 profile 联合类型里，因为 `snapshots/session/` 的清单要按该联合类型校验，而自定义 Cordis profile 依然可以启动。没有任何 fixture 选择这两个 profile。

被删除的三个目录曾持有 `cordis_define`、`cordis_undefine` 与 `cordis_inspect_query` 唯一的录制证据。该能力随 `@redspark/rsh-tool-cordis` 退役，因此证据比包早一个阶段离开。

整条语料仍然没有 PR CI 任务，因此清单之外的运行器再次漂移时仍不会被发现。

## 备选方案

**保留运行器并恢复一个 `default` 组合属主。** 否决：该属主必须重新持有 `cordis.yml`，等于为一个没有任何 Native 重放读取的 Cordis 组合续命，只为了执行五个在启动进程前就已失败的用例。

**为这五个用例补 Native 重放，而不是删除或搁置。** 目前否决：三个工具链用例执行的能力随包退役，`persistent-pwsh-tool-turn` 需要本次改动无法产出的录制会话，`subagent-published-run-failure` 断言的 dispose 文本在 Native 侧是被记录而不是抛出。能被重放接管的两份 fixture 留在原处，清单标记为 `headless`。

**删掉运行器用过的所有 fixture。** 否决：`snapshots/session/pwsh-tool-turn` 是一个通过的 Native 重放的场景，`subagent-published-run-failure` 持有 SDK pin 解析所需的组合与请求头类。

## 验证

`pnpm run test:snapshot` 不再收集这两条被删除的运行器，`rsh/Scripts/session-snapshot-corpus.corpus.ts` 通过：每个 `snapshots/session/` 清单都声明 `profile: headless`，所有组合 pin 仍能解析，adapter 列表与剩余 `*.snapshot.ts` 文件一致。

`snapshots/native-headless/pwsh-tool-turn-native.snapshot.ts` 仍能在 `snapshots/session/pwsh-tool-turn` 里找到会话 fixture；它按路径读取该目录，从不读取清单。它的重放需要先执行 `pnpm run build`，因为它启动 `rsh/Programs/CLI/lib/bin.js`。

`snapshots/` 中已没有任何 `profile: legacy-headless` 或 `profile: legacy-sdk`。
