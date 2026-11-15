# Agent Note: 共用一条 Native Settings 事件流

Status: implemented

[English](2026-11-14-shared-settings-event-stream.md) | 中文

## Problem

Native Web shell 原先每个调用方各开一条 `native-session/settings-events` HTTP 流。shell 已经持有会话列表、工作区、jobs 与 schedule 四条跟随。Chrome 对一个主机只给六条 HTTP/1.1 连接。四个 Settings 调用方加上列表和工作区跟随把插座占满，`POST /api/directories/list` 发不出去，目录对话框的 Open 一直禁用。

`ServerResponse.writeHead` 要等第一段正文才发送响应头。Settings 流没有首帧，这些连接也就不把头送出去。

## Decision

`createNativeSessionClient` 只开一条 Settings 流，把每一帧扇出给所有 `settingsEvents()` 调用方。最后一个调用方中止时才关掉这条流。后加入的调用方只看到加入之后到达的帧；Host 不重放。中止一个调用方只结束那一次迭代。

`NativeHttpBridge` 在 `writeHead` 之后调用 `flushHeaders()`，事件流在第一帧之前就把响应头送出。

## Alternatives considered

**继续每个调用方一条流。** 这就是占满六个插座的安排。

**本地 Host 改走 HTTP/2。** 载体是 `node:http` 的 HTTP/1.1。换载体是更大的改动，也不能阻止客户端无界地打开 Settings 流。

**等 jobs 和 schedule 面板挂载再开跟随。** 四条 Settings 流加上列表和工作区跟随仍然占满六个插座。

## Consequences

目录对话框可以在 shell 跟随开着的时候列举路径。后加入的 Settings 调用方看不到加入前已经到达的帧。中止一个 Settings 调用方不会停掉其他调用方。
