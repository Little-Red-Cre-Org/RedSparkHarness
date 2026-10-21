---
description: "文件系统包组：`ctx.fs` 提供方约定、本地与沙箱强制后端、编辑前读取策略插件，以及面向模型的文件与搜索工具。"
kind: "package-group"
---

# rsh/Modules/Official/fs

[English](README.md) | 中文

## 概述

`fs/` 组为 agent（智能体）提供持久、受策略约束的文件访问：`fs/` 定义文件系统服务约定，`fs-local/` 与 `fs-sandbox/` 提供宿主文件系统与沙箱强制后端，`fs-observation-policy/` 提供编辑前读取策略，`tool-fs/`（`read`、`read_image`、`write`、`edit`）与 `tool-fs-search/`（`glob`、`grep`）提供面向模型的工具。`fs-sandbox/` 同时提供 Cordis 与 Native 提供方入口。部署需选择一个后端、加载对应沙箱策略，并注册模型应看到的工具包；工具及其策略不依赖后端入口。文件 I/O 不设超时；取消会在系统调用边界尽力生效。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

八个包加上远程同级 `fs-e2b` 承担文件系统角色；子系统参考文档完整收录各项约定与错误分类体系。它们的 `dsh.runtime` 声明为 RSH runtime 检查标识 Definition、Provider、Consumer 或 policy 角色，而 `runtime` 导出通过 `dsh-plugin-host` 保留现有 Cordis 生命周期。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`fs/`](fs/README.zh.md) | `ctx.fs` 服务约定：执行世界路径、有界文本 I/O，以及带可选版本防护的原子变更 | `ctx.fs` |
| [`fs-local/`](fs-local/README.zh.md) | 宿主文件系统后端：读取、写入并编辑本机上的真实文件 | 注册到 `ctx.fs` |
| [`fs-sandbox/`](fs-sandbox/README.zh.md) | Cordis 与 Native 沙箱强制提供方：按每次调用的模式约束写入与编辑，读取直接通过 | `ctx.fs` 或 Native `fs` 服务 |
| [`e2b/fs-e2b`](../e2b/fs-e2b/README.zh.md) | 以 E2B 为后端：文件状态位于与 E2B 子进程提供方共享的远程执行世界 | 注册到 `ctx.fs` |
| [`fs-observation-policy/`](fs-observation-policy/README.zh.md) | 编辑前读取策略：记录观测到的存在或缺失，并通过 `fs/*` 事件防护写入/编辑 | `fs/*` 监听器 |
| [`tool-fs/`](tool-fs/README.zh.md) | 面向模型的 `read`、`read_image`、`write` 与 `edit` 工具及其执行器 | 注册到 `ctx.tools` |
| [`tool-fs-search/`](tool-fs-search/README.zh.md) | 由打包 ripgrep 二进制支持的面向模型 `glob` 与 `grep` 发现工具 | 注册到 `ctx.tools` |
| [`tool-str-replace-editor/`](tool-str-replace-editor/README.zh.md) | 独立的 `str_replace_editor` 工具：基于 `ctx.fs` 的 `view`、`create`、`str_replace` 与 `insert` | 注册到 `ctx.tools` |
| [`tool-present/`](tool-present/README.zh.md) | 显式保存交付文件的不可变快照 | 注册到 `ctx.tools` |

策略与工具分离。Cordis `fs-sandbox` 提供方及其 Native 入口分别要求匹配的策略提供方，缺失时会拒绝加载；需要不受约束写入的部署必须显式选择 `fs-local`。沙箱围栏可与编辑前读取门禁组合。`tool-fs-search` 有意不扩展提供方约定——搜索是由进程支持的 ripgrep 工作流，因此文件系统后端无需承担通用搜索 API。

-----

<a id="related-documentation"></a>
## 相关文档

先从子系统参考文档了解共享词汇与错误分类体系，再看塑造该家族的设计决策。

- [文件系统子系统](../../../Docs/subsystems/filesystem.zh.md)——目标、结果、防护、策略事件与错误分类体系。
- [跨能力族 fs 沙箱决策](../../../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.zh.md)——文件系统 seam 上共享的沙箱模式围栏。
- [可移植执行世界消费方决策](../../../../.agents/notes/implemented/architecture/2026-07-28-portable-execution-world-consumers.zh.md)——E2B 后端为何共享远程执行世界。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
