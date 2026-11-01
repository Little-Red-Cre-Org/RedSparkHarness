---
description: "记录一个会话的上下文由什么构成、如何增长：三个持久化投影，以及 /context 命令。"
kind: "package-reference"
---

# @deepseek-ai/dsh-context-insight

[English](README.md) | 中文

## 概述

<a id="summary"></a>

记录一个会话的上下文由什么构成、如何增长，以三个仅运行在 Host 侧的会话投影实现，可仅凭持久化日志重放，无需 Agent 存活。由 Cordis 的 `dsh-context` 插件移植而来：该插件附带一份 617 KB 的预构建浏览器半体，绑定了六个 Cordis 客户端服务，这些在 Native 部署中都不存在，因此保留下来的是持久化分析能力，而不是那份产物。

## 目录

- [概述](#summary)
- [配置](#configuration)
- [组成](#composition)
- [文件布局](#layout)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

## 配置

<a id="configuration"></a>

本包不做任何配置；它只读取固定的状态，也不提供 Schemastery schema。它注册的行是固定的：

| 投影键 | 状态 |
| --- | --- |
| `contextComposition` | 各分类的字符数、轮次/步骤/请求计数、会话发过的每一份 system prompt，以及请求使用的路由。 |
| `contextRequests` | 每个 `request/header` 一行：工具数量、原因，以及是否开启了一段新的消息序列。 |
| `contextActivity` | 按本地自然日：字符数、请求数、轮次、步骤、工具调用。 |

分类刻意保持分离。插件注入与技能加载同样是 user 角色的消息；把它们并入 `user` 会掩盖「上下文中有多少是框架在自言自语」，而这正是本包要回答的问题。

工具 schema 的大小按请求实际发送处（`request/header`）统计，不从恰好使用了某个工具的调用反推。日期使用本地自然日，因为阅读者是按自己的日程划分日界的人；用 UTC 会把晚间的工作记到第二天。

## 组成

<a id="composition"></a>

| 服务 | 用途 |
| --- | --- |
| `sessionProjections` | 注册三个折叠。必需。 |
| `commands` | 注册 `/context`。可选；没有命令服务的部署仍可获得投影。 |

不发布运行时不变式 companion，因为每个折叠都是作用于持久化日志的纯全函数：不存在可以与它相左的第二份观测，状态本身即契约，并由 `stateSchema` 在读取时校验。

## 文件布局

<a id="layout"></a>

| 文件 | 作用 |
| --- | --- |
| [`src/composition.ts`](src/composition.ts) | 构成折叠及其持久化 schema。 |
| [`src/requests.ts`](src/requests.ts) | 请求历史折叠。 |
| [`src/activity.ts`](src/activity.ts) | 按日活动折叠。 |
| [`src/report.ts`](src/report.ts) | 纯文本 `/context` 渲染。 |
| [`src/index.ts`](src/index.ts) | 投影注册与可选命令。 |

## 模型体验

<a id="model-experience"></a>

### `/context` 命令

#### 模型看到什么

什么都不进。命令在一轮之后运行，它回答给它打字的人，不向会话写入任何消息，因此没有任何模型请求因为它的运行而改变。三个投影同样不可见：它们不新增提示词段落、不新增工具 schema、不新增注入。

##### `/context` 的输出

```markdown
Context

  Route      deepseek / deepseek-flash
  Turns      3    Steps 7    Requests 7

Composition — 18,204 chars ≈ 4,551 tokens

  System prompt     █████████████·····  9,412     52%
  Tool schemas      ██████············  4,106     23%
  Your messages     ███···············  2,088     11%
  Tool results      ██················  1,596      9%
  Assistant output  █·················    902      5%
```

#### Token 影响

对任何请求都没有影响。报告是打印在持久化记录之外的文本，它展示的估算是对已存字符数的算术，而不是对下一次请求的测量。

#### KV Cache 影响

无。命令运行不改变任何请求前缀，因此不会使缓存失效，下一轮照旧复用原本就会复用的前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **桌面端目前读不到这些状态。** 投影只能到达那些装配了 `session-projections` 的 profile，目前只有 `native-headless-query`。`native-web` 与 `native-tui` 没有投影注册表，因此要让它上桌面，需要在 Web Host 上新增一条投影通道——那是另一项同时涉及 Host 与客户端的改动。
- **没有仪表盘。** Cordis 插件还渲染了跨会话的 Insights 页面、Context 标签页、Fleet 视图与右侧栏面板。这些没有移植；移植的只有持久化分析与命令。
- **统计的是字符，不是提供方 token。** 这里没有可用的分词器，因此估算是按字符做的算术，而不是提供方自己的计数。当路由声明了 `contextWindow` 时，`request/context` 事件会携带它，报告会如实显示，但不会声称估算与之相符。
- **不计算费用。** 原插件读取一份带价格的目录；本包没有，因此不报告任何金额。

<a id="dev-note"></a>
### 开发备注

无。
