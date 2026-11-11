# Agent Note: Native 回放 LSP 定义查找

Status: implemented

[English](2026-11-11-native-lsp-definition-replay.md) | 中文

## Problem

lsp-definition 的录制让 `lsp` 工具查找 `subject.ts` 里的定义，并保存 `subject.ts:1:7` 和一条省略标记。十二行 Native 测试 profile 没有语言服务器、subprocess 和 prompt sections，所以这段录制无法回放。

## Decision

Native 场景安装 `subprocess-local`、`native-prompt`、`lsp`、`lsp-stdio` 和 `tool-lsp`。stdio 服务器是场景自带的 `lsp-server.mjs`，用当前 Node 可执行文件启动，参数相对工作区。`maxLocations` 保持为 1，和录制里的省略一致。持久化结果包含 `subject.ts:1:7` 和 `1 more location omitted`。

## Alternatives considered

**在测试里桩掉 LSP 服务。** 那就不会运行录制实际使用的 stdio 服务器。Native 回放不会覆盖提供者启动和位置上限。

**提高 maxLocations。** 工具会返回全部位置，省略行会消失。录制结果对不上。

## Consequences

没有安装这些行的 Native profile 不变。这个场景依赖工作区里的语言服务器脚本，以及 Node 能够把它启动起来。
