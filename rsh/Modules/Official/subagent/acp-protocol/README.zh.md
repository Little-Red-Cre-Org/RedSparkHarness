---
description: "定义 Native ACP 子代理执行上限与权限模式所用的带版本元数据。"
kind: "package-library"
---

# @deepseek-ai/dsh-acp-protocol

[English](README.md) | 中文

## 概述

使用本库读写带版本的 Native ACP 子代理执行上限与权限模式元数据。本库会校验 ACP initialize 和 session/new 元数据中的命名空间值；消费方 Program 将接受的 ACP policy 转换为 Engine 持久化的 `execution/policy` event，并负责 transport、执行与强制执行。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制和延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

### 适用场景

当 ACP peer 需要读取或发出带版本的子代理 policy 元数据时使用本库；本库不提供 ACP transport 或子任务执行。

### 入口

将 ACP 元数据对象 `_meta` 字段的值传给 policy reader。扩展字段不存在时返回 `undefined`；数据格式错误或不受支持时抛出 `TypeError`。

```ts
import { readNativeAcpSubagentPolicy } from '@deepseek-ai/dsh-acp-protocol'

const policy = readNativeAcpSubagentPolicy({
  'com.deepseek.ai/dsh-native-subagent': {
    version: 1, maxSteps: 8, permissionMode: 'deny',
  },
})
```

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节——单击展开</summary>

带版本的扩展包含 `maxSteps`、可选的 `maxTokens` 和权限模式（`deny` 或 `parent-relay`）；两个上限都必须是正安全整数。Reader 会拒绝不支持的版本和额外扩展字段，metadata helper 会保留 ACP 命名空间封套。

| 源文件 | 职责 |
|---|---|
| `src/protocol.ts` | 带版本的 metadata 类型、校验和编码。 |
| `src/index.ts` | 公共重新导出。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Subagent 参考](../../../../Docs/subsystems/subagent.zh.md)介绍所有权和 Native external-driver 类型。
- [Native ACP server](../../../../Programs/ACP/packages/native-acp/README.zh.md)介绍消费本协议库的程序。

-----

<a id="model-experience"></a>
## 模型体验

无，本库只校验控制元数据，不构造模型请求。

#### KV 缓存影响

ACP 元数据不会进入模型请求，也不会改变可复用的请求前缀。

## 已知限制和延期工作

<a id="known-limitations-and-deferred-work"></a>

- 本库不发布运行时不变量伴随包，因为它只校验和编码 ACP 元数据，不拥有可供比较的执行状态；消费方 Program 负责转换为持久化事件、执行上限、权限强制执行、Session 持久化和外部子任务传输。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——单击展开</summary>

无。

</details>
