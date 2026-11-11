# Agent Note: Native persists session-reference display form

Status: implemented

[English](2026-11-11-native-persists-session-reference-display-form.md) | 中文

## Problem

Cordis 在存储用户消息之前把规范的 `dsh-session:` 提及改写成 `@label`，并把引用快照追加在运行时上下文消息之前。Native 用规范提及生成快照，却把规范提及存了下来，而且先追加运行时快照。因此 session-reference-spill 这类录制无法对上。若在 prepare 之前改写已准入的输入，prepare 需要的提及也会消失，快照就不会生成。

## Decision

`native-headless` 只在追加已准入的用户消息时调用 `sessionReference.rewrite`。`agent-instructions.prepare` 仍接收原始输入，它的上下文追加在运行时上下文快照之前。需要十二行测试 profile 所没有的行时，场景把出厂 profile 目录作为 `profileRoot` 传入。通过自己的 context 构造应用的程序，包括 TUI、ACP、Web、SDK server 和 SDK 后代夹具，把 `sessionReference` 声明为 optional，因为这次查找用的是调用方的 context。`session-reference-spill` 通过该 profile 回放，`workflow-native` 提交规范提及，并期望存储的是展示形态。

## Alternatives considered

**在 prepare 之前改写已准入的输入。** 存储的消息会变成 `@label`，但 prepare 接着解析的是展示形态，不会发出引用快照。spill 场景会停在 `user, plugin`。

**继续存储规范提及。** `workflow-native` 的 fixture 不用改，但 Cordis 录制里的展示形态对不上。迁移要求的是那份录制的事件序列。

## Consequences

安装了 `sessionReference` 的 profile 存储 `@label`，而不是 `dsh-session:` 提及。`workflow-native` 的父 fixture 只改这一处文本。未安装该服务的 profile 不变，引用快照仍然携带源会话事实。
