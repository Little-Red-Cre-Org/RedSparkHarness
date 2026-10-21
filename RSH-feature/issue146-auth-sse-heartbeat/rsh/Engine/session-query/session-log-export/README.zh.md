---
description: "面向 Web 下载与 Native Host 消费者的会话日志 ZIP 导出，可提供包含会话树与附件的规范归档流。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-log-export

[English](README.md) | 中文

## 概述

`dsh-session-log-export` 让 Web 用户可以把 Session 树与附件下载为 ZIP。Native Host 消费者可以请求相同的规范归档字节流，并自行选择交付方式。本包不选择 Host 路径或传输方式。设置与用法在前，随后说明实现细节。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当 Web 用户需要下载会话，或 Native Host 消费者需要归档流时使用本包。挂载 Web 插件以提供 Session Header 操作和 `/export`；若需程序化访问，则选择 Native 入口并提供 Session 查询、持久化、附件和活动会话服务。

### 何时选择

为 Web 下载或自行管理流目标位置的 Native Host 调用方选择它。Native API 返回文件名和字节流；HTTP、文件或其他传输方式由调用方负责。归档从规范持久化句柄读取，因此各类已挂载后端使用同一格式。

### 组合

```yaml
- id: session-log-download
  name: '@deepseek-ai/dsh-session-log-export'
```

Web bundle 将本包与 Connection、`dsh-commands`、`dsh-client-ui-commands` 和 `dsh-client-ui-conversation` 一起挂载。

Native Host 入口提供 `sessionLogExport`。调用 `createArchive(sessionId, { includeDescendants, signal })`；若根 Session 不存在则返回 `undefined`，否则返回归档文件名与字节流。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `compressionLevel` | `6` | 每个 ZIP 条目的 DEFLATE 级别，范围为 0 到 9。 |

### 命令约定

| 输入 | 结果 |
|---|---|
| `/export` | 记录用户命令的生命周期；提交命令的浏览器下载 `GET /api/session.export?sessionId=<id>&includeDescendants=true` |
| `/export <path>` | 错误；浏览器下载通过浏览器的普通下载行为选择目标位置 |

### 预期行为

Web 弹窗报告三个阶段：准备中、开始下载或失败。关闭弹窗不会取消正在进行的下载，该操作随后结束时弹窗也不会重新打开。每个会话同时只允许一项浏览器下载，重复操作共用该任务。两种 Host 路径都会在读取规范持久化前 flush 实时 Session；Native 导出会检查整个读取期间的确切活动所有者是否保持不变。每份逻辑日志使用当前 generation 的规范文件名（v0 为 `session.jsonl`，其他版本为 `session.vN.jsonl`），每个子会话目录下也遵循同一规则。图片使用 `media/<attachmentId>.<ext>`，通用文件使用 `files/<digest-prefix>/<digest>/<name>`。通用文件以有界分块读取并压缩，因此导出大型上传文件时不会把它完整缓冲进内存。

### 失败

当 ZIP 流式传输开始前的预检失败时——例如 Host 端点不可达或配置错误——弹窗显示准备阶段错误。浏览器接受 GET 后发生的子会话或附件读取失败由浏览器下载管理器报告，不通过弹窗报告。Native 调用方会从 `createArchive` 收到根日志准备错误；后续的子会话或附件错误会使返回流失败，Provider 释放时会中止并排空已接纳的归档工作。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释本包如何接入导出控件，并指出实现它的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计拆分

本包分为三部分。Cordis adapter（[`src/index.ts`](src/index.ts)）注册 `/export` 命令，并向 Connection 贡献精确的 `GET`/`HEAD /api/session.export` Fetch 路由。Native Host Provider（[`src/native.ts`](src/native.ts)）提供 `sessionLogExport`，并在释放时排空已接纳的读取与 ZIP producer。两个 adapter 都使用 [`src/archive.ts`](src/archive.ts) 读取规范日志并有界生成 ZIP；浏览器控件位于 [`src/client/index.ts`](src/client/index.ts)。Web 路由仍使用 Cordis adapter，因此其传输迁移不属于此 Native 能力。

### 下载流程

两条入口都会先向 `/api/session.export?...` 发出 `HEAD` 预检请求，然后把 GET URL 交给浏览器下载管理器，JavaScript 不缓冲 ZIP。一个控制器按会话持有一项进行中的下载，把并发操作折叠进该任务，并在插件释放时取消预检。弹窗状态存放在按会话键控的快照存储中，因此按钮与命令按会话共享一个弹窗。

Host 路由是由该功能拥有的精确 Fetch 路由贡献。Connection 应用 Host/Origin 与浏览器会话检查并桥接流式 `Response`；本包拥有查询校验、活动会话 flush、基于句柄的日志读取与附件读取、ZIP 生成和 HTTP 状态语义。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从 Web 控件逐步进入 Host 端点及相关的命令与会话接口。

- [dsh-client-connection](../../../Programs/Web/client/connection/README.zh.md)——Host 端点使用的认证 Fetch 路由载体。
- [命令子系统参考](../../../Docs/subsystems/commands.zh.md)——`/export` 命令注册的用户命令注册表。
- [dsh-client-ui-commands](../../../Programs/Web/client/ui-commands/README.zh.md)——渲染并确认 `/export` 的浏览器命令界面。
- [会话查询包映射](../README.zh.md)——本包所属的检索包族。
- [Native 活动会话协议](../../core/native-session-execution/README.zh.md)——Native 归档读取前 flush 的确切活动所有者。

-----

<a id="model-experience"></a>
## 模型体验

### 用户 `/export` 控制

#### 模型看到什么

无。`/export` 留在用户命令平面，ZIP 下载不会进入模型历史。

#### Token 影响

为零。该命令不创建模型轮次。

#### KV Cache 影响

无。仅日志命令生命周期与浏览器下载不会改变派生请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明本包何时不合适，或何时需要特别的运维注意。它们是当前包约束，不是任务积压。

- **流，而非目标位置写入器**——Native 调用方选择传输或路径，浏览器选择下载位置。
- **Web 路由仍由 Cordis 持有**——Native 服务不会注册或替换 `/api/session.export`；Web 传输迁移由其载体所有者负责。
- **预检只报告流式传输前的失败**——浏览器接受 GET 后发生的子会话或附件读取失败由浏览器下载管理器报告，不通过弹窗报告。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放设计问题与尚未决定的探索方向。它明确不具权威性——已交付的行为、限制与既定理由以上文、包代码和相关页面为准。

#### 未来：浏览器之外的导出目标

下载刻意限定在浏览器范围；Host 路径或原生文件夹导出需要新的端点约定，并决定 ZIP 的落盘位置。

</details>

**运行时不变式：** 不发布伴生入口。Connection 与命令注册表持有两个注册，每次导出均读取权威的 Session 服务。
