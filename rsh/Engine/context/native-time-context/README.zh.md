---
description: "为原生 profile 作者和维护者提供持久请求时间上下文的原生 Provider。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-time-context

[English](README.md) | 中文

## 概述

`dsh-native-time-context` 提供原生 `timeContext` 服务，源码不直接导入 Cordis。Consumer 请求准备一条请求读数；到期时，服务返回一条带来源的用户消息，由 Consumer 在派生模型请求前追加到 Session。读数包含当前时间、当前轮次的浏览器时区策略和经过时长。本包不会把自身安装到 Agent 循环，也不改变 Session 事件格式。 Consumer 必须先调用 `seed()`，随后对每条已提交事件调用 `record()`；未初始化的 Session 会被拒绝。

## 目录

- [使用本包](#use-this-package)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

当原生 profile 中的应用需要向模型提供持久时钟上下文时，安装此 Provider。Consumer 在模型分发前调用 `prepare({ session, turn, step, requestMessages })`，把返回消息作为 `user/message` 追加，然后再派生请求。`requestMessages` 用于提供应用尚未追加的新用户消息；它会参与浏览器时区选择，但不替代 Session 持久化。

```json
{
  "id": "time-context",
  "plugin": "@deepseek-ai/dsh-native-time-context",
  "scope": "root",
  "config": {
    "timeZone": "Asia/Shanghai",
    "refreshIntervalMs": 30000
  }
}
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `timeZone` | Provider 激活时解析的 Node 进程时区 | 当前开放轮次没有唯一浏览器时区时的显示回退时区 |
| `refreshIntervalMs` | `0` | 同一 Session 两条读数之间的最小经过毫秒数；`0` 会在每次请求准备时添加读数 |

配置会在激活前解析。未知字段、无效时区、负数间隔和非安全整数间隔都会使 profile 激活失败。受支持字段由[`Config`](src/index.ts)声明。

### 时区选择与刷新

服务只信任开放轮次中 user-RPC 消息携带的、经 Host 规范化的浏览器时区。存在唯一时区时，时间戳按该时区格式化，面向模型的指令也会说明该时区。浏览器时区缺失或混杂时，仅用配置时区或进程时区格式化时钟；面向模型的指令仍会要求用户澄清未明确限定时区的日期与时间。回退时区不会被描述成用户时区。

Consumer 使用已经加载的 Session 事件初始化时间投影，并在每次追加事件后推进它。刷新间隔使用投影中最新的 `native-time-context` 注入，因此恢复后的 Session 可延续调度。第 1 步从最近一条先前的用户消息、助手消息或工具结果起计算经过时长。后续步骤从该轮最新一条时间上下文注入起计算。没有基线时显示 `unavailable`；挂钟倒退时，经过时长会钳制为零。

每条返回的用户消息包含带数字 UTC 偏移和 IANA 时区的时间戳、浏览器时区策略，以及整秒经过时长。

```markdown
Time sampled while preparing turn <turn>, step <step>: <timestamp>
Browser time zone for this request: <resolved-zone-or-clarification-policy>
Elapsed since the preceding <model-visible-message-or-step-context>: <duration-or-unavailable>.
```

消息来源为 `{ kind: 'plugin', plugin: 'native-time-context', form: 'snapshot' }`。为了让 Session 回放和请求历史都包含该消息，Consumer 必须在下次模型请求前追加它。

<a id="dev-note"></a>
## 开发备注

不发布 invariant companion：服务只对 Consumer 提供的 Session 事件维护一份投影，没有可用于比对的独立状态。

<a id="model-experience"></a>
## 模型体验

Consumer 负责在模型分发前追加到期读数；这些持久用户消息会进入后续请求，直至被压缩遮蔽。

#### KV Cache 影响

读数追加在现有请求历史之后，不会改变新消息之前可复用的前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- Provider 不会添加浏览器时区 RPC 字段；Host 必须提供规范的 user-RPC 来源信息，服务才能使用该时区。
- 服务只返回消息，不负责追加。每个应用负责控制追加顺序、持久化和错误处理。
- 正数间隔可能在新轮次抑制读数；当前请求的历史中仍会包含之前已持久化的读数。
- 本包及其 Session 依赖仍按仓库过渡策略声明 Cordis peer；P5 负责将 Cordis 从纯原生产物依赖闭包中移除。
