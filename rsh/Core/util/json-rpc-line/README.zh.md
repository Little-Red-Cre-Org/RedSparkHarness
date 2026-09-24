---
description: "供 SDK 协议与 Codex app-server 适配器共用、运行在调用方拥有的 Node 流上的逐行 JSON-RPC 传输。"
kind: "package-library"
---

# @deepseek-ai/dsh-json-rpc-line

English | [中文](README.md)

## 概述

`dsh-json-rpc-line` 让调用方通过自己拥有的 Node 流交换 JSON-RPC 请求、响应和通知。SDK 协议与 Codex app-server 适配器共用这层传输，各自仍拥有自己的协议消息。流和子进程的生命周期由调用方负责。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

SDK 客户端和服务端用本库处理 stdio 分帧；Codex 适配器用它处理 app-server 分帧。调用方提供可读流和可写流，调用 `start()`，并在释放流之前关闭传输。`close()` 会拒绝待完成请求并移除监听器，但不会销毁任一流。

```text
const transport = new JsonRpcLineTransport(input, output)
transport.start()
const result = await transport.request('method/name', {})
transport.close()
```

协议错误响应会以 `JsonRpcResponseError` 拒绝请求，并保留数字错误码及可选数据。请求取消、通知、flush 和处理器行为见 [`src/index.ts`](src/index.ts)。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

传输层在字节块之间持续解码 UTF-8，分发以换行结尾的完整帧，并用生成的请求 id 对应响应。每个端点只拥有自己的待完成请求和监听器；流及进程清理由调用方负责。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 行分帧、JSON-RPC 分发、请求关联与待完成请求结算 |

不发布 invariant companion：传输层没有与自身待完成请求表相独立的状态所有者可供比较。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [工具库目录](../README.zh.md) — 其他共用原语。
- [SDK 协议](../../../Programs/SDK/packages/protocol/README.zh.md) — 使用这层传输的 SDK 方法和通知类型。
- [Codex 适配器](../../../Engine/subagent/subagent-codex/README.zh.md) — 使用同一分帧方式承载的 app-server 方法。

-----

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **流由调用方拥有**——关闭传输不会关闭子进程，也不会销毁输入流和输出流。
- **没有帧大小上限**——传输层会缓冲尚未结束的一行；调用方应使用受信任的对端，或在本库之外限制输入。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
