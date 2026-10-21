---
description: "context 组概览：不定义工具、为每次请求添加持久且模型可见上下文的插件，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# context/ — 请求上下文插件

[English](README.md) | 中文

## 概述

context 组定义 Native request-context 服务并提供可选贡献器：工作区指令文件成为指引，`@file` 提及提供路径补全，其他会话可以作为有界快照被引用，模型还能看到当前时间与 agent（智能体）的 tmux 位置。`dsh-base` 默认包含 `agent-instructions`，profile patch 可以禁用它。上下文是持久的：注入的指令与引用以用户角色消息的形式进入会话历史，因此与其他对话内容一样持久保留、可回放、可压缩。本页概述本组；包级约定由各包 README 负责。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`agent-instructions/`](agent-instructions/README.zh.md) | 将 `AGENTS.md`、`CLAUDE.md` 工作区指令加载到上下文，并在文件编辑后刷新 | — |
| [`session-reference/`](session-reference/README.zh.md) | 引用其他会话：提及一个会话，其有界只读快照即成为上下文 | `ctx.sessionReferenceResolver` |
| [`file-reference/`](file-reference/README.zh.md) | `@file` 发现约定、Native 服务声明与共用提及语法 | `ctx.fileReferences` |
| [`file-reference-local/`](file-reference-local/README.zh.md) | `@file` 提及的 Cordis 本地工作区补全提供方 | — |
| [`time-context/`](time-context/README.zh.md) | Cordis Agent pre-step Provider：每个步骤的当前时间、浏览器时区与经过时长 | `ctx.sessionProjections` |
| [`native-time-context/`](native-time-context/README.zh.md) | 原生 Provider：向应用 Consumer 返回持久的当前时间、浏览器时区与经过时长消息 | `timeContext` |
| [`tmux-context-definition/`](tmux-context-definition/README.zh.md) | 持久 tmux 上下文服务的 Cordis-free Native Definition | `tmuxContext` |
| [`native-tmux-context/`](../../Modules/Official/terminal/native-tmux-context/README.zh.md) | 通过所选 shell 查询 agent 自身 tmux 会话、窗口与窗格的 Native Provider | `tmuxContext` |
| [`tmux-context/`](tmux-context/README.zh.md) | 提供 agent 所在 tmux 会话、窗口与窗格位置的兼容 Agent pre-step Provider | — |
| [`request-context-definition/`](request-context-definition/README.zh.md) | 定义 Native request-context provider 与接受结果类型 | `requestContexts` |
| [`request-context/`](request-context/README.zh.md) | Native registry：按 scope 排序贡献器，并将消息接受操作交给持有 Session 的 Program | `requestContexts` |

-----

<a id="related-documentation"></a>
## 相关文档

- [会话引用子系统](../../Docs/subsystems/session-reference.zh.md)——规范的提及 URI、快照语义与稳定的错误分类体系。
- [工作区上下文决策记录](../../../.agents/notes/archived/feature/2026-06-24-workspace-context.md)——指令上下文为何按 agent 和会话两个维度隔离并持久记录。
- [生成的配置目录](../../Docs/config-catalog.zh.md)——本组各包接受的全部配置字段。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
