# Agent Note：legacy ACP 面退役

Status: implemented

[English](2026-11-18-legacy-acp-surface-retires.md) | 中文

## 问题

随附的 `acp` profile 名初始化 `native-acp`，因此 `rsh/Programs/CLI/tests/profiles/acp/` 的 Cordis ACP 组合与 `snapshots/acp/` 只有在测试显式创建 `legacy-acp` profile 时才会执行。那套用例不是判定基准：在已合并的基线上，15 个录制场景中有 6 个因为 provider 的 `config_option_update` 顺序与录制不同而失败。

`snapshots/acp/` 包含四个组合：`escalation-approved`、`fs-escalation-approved`、`image-compaction`，以及 #373 之前的 `reject-extra-dirs` 与 `cancel-tool-calls`。若保留这些目录而删除其 profile，语料检查会继续选择启动器已不再启动的 profile。

## 决定

整体删除 `rsh/Programs/CLI/tests/profiles/acp/` 与 `snapshots/acp/`。

`snapshots/native-acp/fs-escalation.snapshot.ts` 取代 `fs-escalation-approved`。它从随附的 `native-acp` 组合构建私有 profile，把 `fs` 换成 `@redspark/rsh-fs-sandbox`，将常驻策略设为 `read-only`，并通过 `native-tools` 注册 `@redspark/rsh-tool-fs`。录制的写入先被沙箱拒绝并给出升级提示，重试调用携带 `sandbox_permissions: workspace-write` 与理由，客户端批准一次后 `escalated.txt` 落盘。升级路径必须留在 Session workspace 内，因为 `tool-fs` 拒绝工作区之外的路径。

`cancel-tool-calls` 与 `reject-extra-dirs` 已在 #373 中分别让位给 `snapshots/native-acp/tool-cancel.snapshot.ts` 与握手断言。`snapshots/web/bash-abort-row/session.v3.jsonl` 现在持有 `bash-abort-row` 与 `native-bash-abort-row` 重放的录制 Session，因此删除 `snapshots/acp/` 不会移除 Web 夹具。

`rsh/Compatibility/DSH/subagent/subagent-acp` 的 ACP e2e 改为不带 overlay 启动 `--profile acp`。随附组合已经选择 `deepseek-official` 与录制的 DeepSeek 路由，所以被删除的 `cordis.yml` overlay 没有替代文件。

## Native 未重放的部分

`image-compaction` 通过 DeepSeek 路由为六张图片计价，`retainTokens` 为 `100`。无 key 的 `pi-ai` 重放 provider 不提供图片计价，而 `@redspark/rsh-llm-deepseek` 需要凭据，因此没有无 key 的 Native 重放能断言这些数值。该组合随本注释记录的数值一起删除。

`escalation-approved` 把一次 Bash 调用升级到工作区之外的 `danger-full-access`，并断言 Cordis 夹具插件的 `subagent/end` 标记。Native profile 的 Bash 升级路径仍未录制；`fs-escalation` 证明的是 `write` 的拒绝、重试、批准与写入效果，不是 `bash`。该标记插件只用于观察 Cordis subagent 生命周期，Native 以 job 事件报告同一生命周期。

`rsh/Programs/CLI/package.json` 仍声明 `@redspark/cordis` 与 Cordis 时代的可选包。关闭 CLI 的 legacy 启动与导出模式是下一刀；本次只移除与 ACP 绑定的面。

## 考虑过的替代方案

**保留 `snapshots/acp/` 并把它指向随附的 `acp` profile。** 否决。这些组合携带 Cordis 行、`!!js` 表达式与夹具插件；该 profile 名现在选择 Native，运行器要么解析失败，要么断言另一套组合。

**把 `escalation-approved` 改写成 Native Bash 升级重放。** 本次否决。`tool-fs` 已通过同一 approval 服务给出录制的拒绝、重试与批准路径；在 CLI 收尾之前增加第二个 Native ACP 在途场景只会扩大本 PR，而不改变产品代码。

**把 `image-compaction` 移到 `native-acp` 但去掉计价断言。** 否决。该场景的存在目的就是断言压缩计价；省略数值的重放只会留下一个什么都证明不了的夹具。

## 后果

`snapshots/acp/` 不再存在，`rsh/Scripts/session-snapshot-corpus.corpus.ts` 列出 `native-acp` 与 `fs-escalation`。快照 manifest 只接受 `headless`、`sdk`、`native-headless`、`native-sdk`、`native-acp`、`native-web` 与 `web`。legacy ACP profile 目录已删除，因此 `dsh --profile legacy-acp --from-default-profile acp` 是组合该 Cordis 树的最后入口；CLI 收尾会删除这条路径。
