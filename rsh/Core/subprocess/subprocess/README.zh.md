---
description: "面向组合作者与能力消费方的子进程服务（`ctx.subprocess`）说明：启动、观察并终止受管子进程与终端会话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-subprocess

[English](README.md) | 中文

## 概述

`ctx.subprocess` 可解析可执行文件、启动受管子进程和终端会话、有界收集输出，并终止其拥有的进程范围。每次请求都指定 argv、工作目录、stdio、环境、宽限期与取消信号；时限、拆卸策略和面向模型的渲染由调用方负责。子进程环境默认先清除环境中的凭据与 `DSH_*` 值，再应用显式覆盖；调用方也可显式选择完整替换，以满足由自己拥有完整环境的公开契约。

原生提供方与消费方可从 `./native` 获取不依赖 Cordis 的 `SubprocessOperations` 和 `ChildConnectionDefinition` 契约、共享子进程连接释放函数及环境辅助函数。`childConnection.connect()` 始终请求原始 stdin/stdout/stderr 管道，并返回直接退出结果与受管范围所有权。包根入口仍是现有组合使用的 Cordis 服务。

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

在需要运行子进程的组合中挂载一个 subprocess 提供方，并从拥有该命令的能力调用 `ctx.subprocess`。常用路径是显式的：解析可执行文件、用完全明确的请求 spawn、读取你要的输出，并在工作完成时终止受管范围。

### 挂载服务

每个组合由唯一一个提供方注册 `ctx.subprocess`；把它与经由它 spawn 的消费方放在一起加载——bash 执行器、LSP 主机、PTY shell 后端或进程外 subagent 后端。加载第二个提供方会快速失败（每个上下文只有一个服务，这是 Cordis 的标准行为）。

```yaml
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@deepseek-ai/dsh-bash-local'
```

### 启动受管进程

请求完全明确：程序与参数、工作目录、每条流一种 stdio 处置方式、终止宽限期、可选的中止信号与可选的环境覆盖。目标与受管范围标识保留在提供方内部。`done` 以直接命令的退出事实（`exitCode` 与 `signal`）resolve，并在 spawn 或提供方失败时 reject；收集输出在退出后仍可读取。

```text
const executable = await ctx.subprocess.resolveExecutable('bash')
const handle = ctx.subprocess.spawn({
  argv: [executable, '-c', 'echo hello'],
  cwd: '/workspace',
  stdio: { stdin: 'ignore', stdout: { maxBytes: 64 * 1024 }, stderr: 'inherit' },
  graceMs: 5000,
})
const { exitCode, signal } = await handle.done
const output = handle.collected.stdout?.readFrom(0)
```

### 选择输出投递方式

- `'pipe'` 把原始流交给你做自己的协议分帧——LSP 主机用 JSON-RPC，ACP（Agent Client Protocol）后端用 ndjson。
- `'inherit'` 让子进程直接写父进程自己的流，用于直通诊断输出。
- 收集对象（collect object）在内存中缓冲一段有界尾部；加上 `spill` 上限后，完整流还可以从 spill 文件中恢复。

读取基于偏移量且从不消费：后台读取与最终批量读取可以共享同一条流，而不会抢走彼此的字节。

### 管理进程生命周期

终止与等待使用同一个由提供方管理的范围。`terminate()` 会启动提供方记录的流程，具有幂等性，并在该范围为空后成为空操作；请求的中止信号会启动同一流程。`waitForExit()` 观察同一范围，只在提供方证明它完全停稳后 resolve，因此直接命令结束不会掩盖仍存活的后代。所选 owner 无法再证明完全停稳时，它会 reject。提供方记录其 native owner 与较弱 fallback；时限、拆卸阶梯与原因分类归调用方所有。

### 运行终端会话

对于交互式程序，`spawnTerminal` 分配真实 PTY：写入文本、读取 UTF-8 输出、检查当前前台进程组并向其发送信号，以及等待一次 `terminate()`，让提供方仍可观察到的每个会话成员完全停稳。就绪状态、scrollback 与提示符策略仍归 PTY 消费方所有。

### 每个子进程起步时的环境

普通 subprocess 请求使用 scrub-overlay 模式：形似凭据的名称与环境中的 `DSH_*` 事实都会被清除，再应用显式条目；显式的 `undefined` 墓碑值可移除一个普通环境项。Child connection 也可选择 `envMode: 'replace'`，此时子进程只接收提供的环境条目，不继承或清理 ambient 环境。

### 可能出错的地方

无法解析可执行文件时，服务会明确报出稳定的错误。从未启动成功的 spawn 会让 `done` reject；从未运行过的进程没有任何缓冲输出。提供方无法证明所选范围为空时，`waitForExit()` 也会 reject；提供方 fallback 可能无法拥有逃离其进程组或已观察会话的后代。独立协议客户端可直接使用 `ChildConnectionDefinition`，无需构造 NativeHost；命令解析和环境策略仍由 Programs 拥有。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释 seam 背后的设计决策，并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中说明。

### 设计理念

本 seam 建立在一个分离之上：服务负责进程坐标与生命周期；消费方负责定义进程的含义，以及决定塑造该进程的每一项默认值。正因如此，spawn 请求完全明确——没有任何隐藏的子进程服务默认值——`SubprocessOutcome` 也只携带退出事实：时限、拆卸阶梯与原因分类归调用方所有。`dsh-shell` 的 request/spec 拆分是这条规则的所属模板。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Cordis 服务入口：抽象 `SubprocessRuntime`、`ctx.subprocess` 注册和共享的 `scrubbedParentEnv` 清除 |
| [`src/native.ts`](src/native.ts) | 无框架依赖的 `SubprocessOperations` 与 `ChildConnectionDefinition` 服务契约 |
| [`src/connection.ts`](src/connection.ts) | 子进程连接的 EOF、提供方终止及受管范围释放 |
| [`src/types.ts`](src/types.ts) | 词汇：spawn/connection spec、环境模式、stdio 句柄、读取器、结果、`DSH_*` 命名空间 |
| — | 进程观测和 OS 信号由 Provider 拥有；连接消费方拥有协议关闭与宽限期数值。 |

### 数据模型与流程

spawn 会立即返回活动句柄，而不公开目标身份。`done` 独立报告直接命令的结果或失败，`waitForExit()` 则报告受管范围是否完全停稳。请求的中止信号驱动与 `terminate()` 相同的终止流程。收集模式的读取器无游标：偏移量是调用方拥有的全流字节坐标，因此独立读取器不会消费彼此的输出，偏移量滑出内存尾部的读取标记为 `lossy`，并在 spill 文件存在时指向它。`spawnTerminal` 是一项底层原语，因为普通管道无法分配控制终端或清理终端会话成员。

### 生命周期与不变式

每个上下文只注册一个实现；加载第二个会抛错（Cordis 标准行为）。服务自身的 dispose（资源释放）会终止所有仍在运行的受管进程并等待其退出，因此进程生命周期在消费方重载后依然延续。`argv` 绝不经过 shell 解释；需要 shell 的消费方自行传入 `['bash', '-c', command]`。终端分配的取消（spec 信号）与已发布句柄的生命周期相互独立。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从穷尽式类型参考逐步进入各提供方，以及 seam 背后的决策证据。

- [子进程子系统](../../../Docs/subsystems/subprocess.zh.md)——spawn spec、输出读取器、结果与完整的 `DSH_*` 环境。
- [dsh-subprocess-local](../subprocess-local/README.zh.md)——实现本约定的本地宿主提供方。
- [dsh-subprocess-e2b](../../../Modules/Official/e2b/subprocess-e2b/README.zh.md)——同一 seam 的远程 E2B 提供方。
- [dsh-bash-local](../../../Modules/Official/shell/bash-local/README.zh.md)——最大的消费方：经由本服务运行 bash 命令。
- [subprocess seam Agent Note](../../../../.agents/notes/archived/architecture/2026-07-26-subprocess-seam.md)——进程部分为何成为独立的 seam，以及随之迁移的内容。

-----

<a id="model-experience"></a>

收集输出流接受可信 `onData` 观察回调，不消耗或替换保留的输出。回调不得抛出异常。

## 模型体验

通过消费方 seam（例如 bash 执行器家族）间接影响，它们负责进程输出与生命周期的全部面向模型渲染。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由上述消费方负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明该 seam 何时不合适，或何时把工作留给消费方。它们是当前包约束，不是对比或任务积压。

- **协议关闭仍由消费方拥有**——SDK client 使用共享 ChildConnection Definition 和生命周期 helper，但无需构造 NativeHost；每个协议消费方仍拥有自己的 shutdown 交互和 EOF/最终等待宽限期。
- **提供方仍拥有终止机制**——共享 disposer 会关闭 stdin、等待，然后启动所选 Provider 的终止流程并等待受管范围释放；不同 OS 的信号升级仍由 Provider 内部完成。
- **可观察性取决于提供方**——native 提供方可以通过 systemd scope 或 Windows Job 拥有逃逸后代，fallback 提供方则只暴露较弱的进程组、进程树或会话可见性。该 seam 不新增持续的进程表监视器。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放设计问题与尚未决定的探索方向。它明确不具权威性——已交付的行为、限制与既定理由以上文、包代码和相关 Agent Note 为准。

未来：非 shell 运行器。该 seam 拆分的目的就是让直接 argv 执行器或 worker supervisor 无需深入 bash 内部即可消费它；目前尚无任何实现交付，终端原语也把就绪策略留在其消费方。

</details>
