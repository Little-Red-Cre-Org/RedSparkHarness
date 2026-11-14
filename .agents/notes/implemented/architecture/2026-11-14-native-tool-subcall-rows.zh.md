# Agent Note: Native Tool sub-call rows

Status: implemented

[English](2026-11-14-native-tool-subcall-rows.md) | 中文

## Problem

`ptc-round` 回放断言 `run_code` 父行、`[data-subcalls]` 内的 `[data-sample=bash]`，以及从该行展开的 `[data-terminal]`。`NativeToolCard` 之前把每个根调用和嵌套调用都交给 `GenericToolCard`。该卡片有 Bash 变体，但不拥有兼容 toolview 的 `data-sample` 行和可展开的内联终端，因此播种的 PTC 轮次无法满足 Cordis 选择器。

## Decision

`BashRow` 拆成纯 `BashCard`（接收已解析的 `cwd`）和通过 `useSessions` 读取 Session 工作区的 Cordis 包装。`NativeToolCard` 把 wire 名称 `bash` 分派给 `BashCard`，其余工具继续使用 `GenericToolCard`。嵌套子调用走同一分派器，因此任意深度的 Bash 子调用都会使用终端卡片。

## Alternatives considered

**只在根调用渲染终端。** 记录的 Bash 调用是 PTC 子调用，只处理根调用会让被断言的行保持通用形态。

**在 `native-application` 里复制 Bash 行。** 展开状态、终端模型和文案已经在 `ui-tool` 中；第二份实现会与兼容行及其终端测试漂移。

**让 `GenericToolCard` 负责 `data-sample` 和终端展开。** 这会让每个 Bash 变体有两条展开路径，并让通用行承担 keyed toolview 的交互。

## Consequences

Native 的 `run_code` 轮次现在会显示与兼容转录相同的嵌套 Bash 行和内联终端，`web-ptc` 因此可以在 `native-web` 上回放。纯卡片是共享的，终端行为只需改一处。没有 Native 分派的工具仍回退到 `GenericToolCard`，该回退也是加入下一种移植的位置。
