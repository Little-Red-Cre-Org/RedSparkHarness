# Agent Note: Native 跟踪每一次 Session 追加

Status: implemented

[English](2026-11-11-native-tracks-every-session-append.md) | 中文

## Problem

Native 持久化只记录传给 `NativeContinuationSession.track` 的事件。工具结果策略里直接 `session.append` 会推进内存序号，却不进入这批待写事件。下一次被跟踪的追加就会报 `append seq mismatch`。agent-instructions 的录制在第一次 `read` 的结果落盘之前压缩工作区基线，所以这个场景无法回放。

## Decision

`Session.onAppend` 在事件进入日志之后通知。continuation owner 在存活期间订阅，并跟踪每条新事件。`track` 忽略已经在待写批次里的事件，因此现有的 `track(session.append(...))` 仍然只写一次。`agent-instructions` 通过 Native profile 回放。它的压缩夹具在 `postResult` 期间追加，持久化日志里压缩事件排在第一条工具结果之前。分隔目录只在非 Windows 主机上创建，因为目录名包含 `<`。

## Alternatives considered

**不持久化压缩事件。** 内存日志能看到这些事件，但写入器会拒绝下一次追加。录制对不上。

**让夹具持有 continuation owner。** 工具插件拿到的是 Session，不是写入 owner。为了一个夹具把 owner 放进每次工具调用，会放宽工具执行类型。

## Consequences

由活动 continuation writer 持有的 Session 上的任何追加都会落盘，包括工具结果策略里的追加。关闭 owner 时会在最后一次刷盘之前取消订阅。观察者抛错不会回滚已经接受的事件。
