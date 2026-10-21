---
description: "强制沙箱的 `ctx.fs` 后端：面向把模型文件变更限制在会话工作区内的部署方与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-fs-sandbox

[English](README.md) | 中文

## 概述

`dsh-fs-sandbox` 提供 Cordis 与 Native 文件系统入口，按每次调用的沙箱策略约束模型写入与编辑，同时保留本地读取行为。`read-only` 拒绝变更；`workspace-write` 只允许目标位于工作区或平台临时根目录内；`danger-full-access` 不做路径围栏，直接委托。两个入口共享规范化包含检查与本地原子后端。被拒绝的操作返回 `FS_SANDBOX_DENIED`，文件系统工具会显示当前模式和同轮次升级提示。

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

当模型写入与编辑必须遵循会话沙箱模式、而读取保持不受约束时，选择此提供方替代 `fs-local`。围栏按调用生效：工具层把调用会话的模式与工作区根目录解析为与 bash runner 收到的相同策略，因此文件系统与 shell 两个能力族绝不会约束到不同根目录。

### Cordis 组合

先加载共享策略服务，再加载此后端，最后加载工具；编辑前读取策略插件仍为可选。

```yaml
- name: '@deepseek-ai/dsh-sandbox-policy'
- name: '@deepseek-ai/dsh-fs-sandbox'
  config:
    cwd: /absolute/path/to/workspace
- name: '@deepseek-ai/dsh-tool-fs'
```

后端的配置与本地后端完全相同（`cwd` 解析默认值与 `diffBasisMaxBytes` 覆写上限）；[配置目录](../../../../Docs/config-catalog.zh.md#deepseek-aidsh-fs-sandbox)是完整配置的真源。

### Native profile 组合

本包还导出仅支持 Host 的 `./native` 入口，由 `LocalFileSystemBackend` 提供相同的 `fs` 服务，并要求 `dsh-native-sandbox-policy` 提供 `sandboxPolicy` 服务。关闭开始后，Native 入口会拒绝新的变更，并等待已准入的写入与编辑（包括包含检查和后端 I/O）结束，再停止 Host 安装。请显式选择 Native 策略与此提供方；任一提供方缺失时都不会安装本地文件系统回退。

`runtime` 入口仍是 Cordis 适配器，并继续要求 `dsh-sandbox-policy`。可选 peer 元数据允许仅安装 Native 入口时省略 Cordis、Plugin Host 与旧策略包；它不会选择入口，也不保证 Cordis 入口在缺少其宿主和策略提供方时能加载。

### 围栏行为

有效模式来自调用会话的覆盖值或升级授权，两者都未生效时才回退到部署默认值。`read-only` 以结构化 `FS_SANDBOX_DENIED` 拒绝所有变更。`workspace-write` 只允许目标规范化后位于工作区根目录或平台临时区域（`/tmp`、`os.tmpdir()`）之下的变更——与 Seatbelt profile 授权的可写集合相同。`danger-full-access` 不加围栏直接委托。

### 可观察的成功与失败

读取、列出与元数据操作与 `fs-local` 完全一致。被拒绝的变更返回携带有效模式的 `FS_SANDBOX_DENIED` 错误；经工具，模型会看到 `[sandbox: file access denied under <mode> mode]` 及唯一一次获批更宽权限的重试提示，与 bash 的拒绝完全相同。获得批准升级的会话可以在该次调用中以严格更宽的模式重试同一操作。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释沙箱后端背后的设计决策，并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

围栏是在可信代码中检查模型控制路径的策略，而非内核边界。操作属于 seam 自身（open、rename），只有目标路径不可信，因此「规范化后检查包含关系」就是该接口的完整答案。不可信代码的内核级隔离仍由 `ctx.shell` 负责。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `SandboxedFileSystem`：`writeText`/`editText` 上的模式围栏、`sandboxMode` 事实 |
| [`src/native.ts`](src/native.ts) | Native Host 提供方，使用相同本地后端并要求 Native 策略 |
| [`src/policy.ts`](src/policy.ts) | 两个提供方入口共享的逐调用目标检查 |
| [`src/containment.ts`](src/containment.ts) | 祖先包含检查，带词法快速路径与基于身份的兜底 |

### 变更如何被围栏

每次变更先解析按调用策略（`danger-full-access` 原样返回调用方目标；`read-only` 抛出 `FS_SANDBOX_DENIED`），`workspace-write` 则立即重新规范化目标，并要求它位于由唯一的 `writableRoots` 函数派生的某个可写根之下——与 Seatbelt profile 授权的集合相同，因此 fs 围栏与 bash runner 不会漂移。被变更的正是这个新目标，因此工具解析后被替换的符号链接祖先也会被发现。

### 威胁模型

解析到系统调用之间残留的 TOCTOU 通过写入前立即重新规范化来缩小，并为该威胁模型所接受；内核严密边界需要 `openat2` 一类原语，其可移植性成本在此不值。拒绝是结构化 `FsError`，而不是 stderr 推断——进程内围栏准确知道自己拒绝了什么。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从本后端逐步进入共享策略归属及其背后的隔离决策。

- [文件系统子系统](../../../../Docs/subsystems/filesystem.zh.md)——穷尽式提供方约定、策略事件与错误分类体系。
- [dsh-fs](../fs/README.zh.md)——本后端实现的 `ctx.fs` 约定。
- [fs-local](../fs-local/README.zh.md)——本后端扩展的本地后端。
- [sandbox-policy](../../sandbox/sandbox-policy/README.zh.md)——Cordis 逐会话策略解析器。
- [native-sandbox-policy](../../sandbox/native-sandbox-policy/README.zh.md)——Native 逐会话策略提供方。
- [进程沙箱子系统](../../../../Docs/subsystems/sandbox.zh.md)——模式、逐调用策略与故障关闭错误。
- [跨能力族 fs 沙箱决策](../../../../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.zh.md)——共享模式围栏及其升级编排。

-----

<a id="model-experience"></a>
## 模型体验

### 文件系统策略与拒绝

#### 模型看到的内容

在 Cordis 组合中，策略归属方贡献与具体能力无关的 `sandbox:policy` 上下文。任一入口的 `FS_SANDBOX_DENIED` 拒绝都会由 `dsh-tool-fs` 渲染为 `[sandbox: file access denied under <mode> mode]` 标记和同轮次升级提示。

#### Token 影响

Cordis 沙箱后端挂载期间，当前策略条款会增加一条简短的运行时上下文消息；拒绝则会把有界标记与升级提示追加到对话历史。Native 提供方按每次变更收到的策略实施约束。

#### KV Cache 影响

常驻策略发生变化时，会在保留的历史之后追加一份由归属方渲染、取代先前状态的运行时上下文快照；操作结果保持仅追加。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明沙箱后端何时不合适，或何时需要特别的运维注意。它们是当前包约束，不是通用沙箱对比或任务积压。

- **策略围栏，而非内核边界**：该检查是可信代码处理模型控制的路径，因此解析到系统调用之间残留的 TOCTOU 会被原位重新规范化缩小，但不会消除；对抗性宿主进程不在范围内。不可信代码的内核级隔离仍属于 `ctx.shell`。
- **围栏与 runner 的一致性由单一所有方派生**：可写集合来自 `writableRoots`，该函数与 Seatbelt profile 共享；在其他位置定义可写集合的 runner profile 会发生漂移。
- **所选入口必须组合相应策略提供方**：Cordis 使用 `ctx.sandboxPolicy`；Native 要求 `sandboxPolicy` 服务。任一入口都不会在策略缺失时回退到不受约束的提供方。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。这个无状态适配器把策略与文件系统关系委托给各自所属的 seam。
