# Agent Note: Native 外部后台

Status: implemented

[English](2026-11-14-native-external-background.md) | 中文

## Problem

已录制的 `product-subagent-result-diagnostic` 调用设置了 `run_in_background`。Native `subagent` schema 对外部 provider 省略了该属性，而 `startBackground` 要求 session-backed provider。回放因此会在驱动返回已录制 diagnostic 之前拒绝这些调用。

## Decision

安装了 job 控制时，外部一次性执行可以作为归 Agent 所有的 job 运行。`startBackground` 使用外部驱动，不调用 `assertSessionBackedProvider`。job 只在 `subagent/external-start` 刷新之后启动。返回的 id 是 `NativeExternalSubagentId`，不是 Session id。渲染器打印该操作 id 和 remote id。它不得把该操作称为子 session。

驱动选择仍由 subagent 插件的 `providerName` 决定。工具 `config.provider` 会变成路由覆盖。未声明该字段的驱动会在启动前拒绝调用。

## Alternatives considered

**从回放中去掉 `run_in_background`。** 已拒绝。已录制的调用包含该字段。安装了 job 控制的 Native profile 必须接受它。

**给 stub 驱动的路由字段加上 `provider`。** 已拒绝。插件名选择驱动。驱动不支持的路由字段会在启动前失败，而该录制场景不需要路由覆盖。

**启动真实产品子进程。** 已拒绝。已录制的 diagnostic 已经在 fixture 里。stub 驱动返回它们。该场景不需要产品二进制。

## Consequences

外部后台仍是一次性执行。它不创建子 Session，也不能继续。`job_output` 查找带 kind 前缀的 job id，例如 `subagent-1`，而不是工具的 remote id。`product-subagent-result-diagnostic` 现在不启动产品子进程即可回放，它的 `snapshot.yml` profile 是 `headless`。
