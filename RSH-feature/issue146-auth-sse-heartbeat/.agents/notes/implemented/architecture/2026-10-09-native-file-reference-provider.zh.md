# Agent Note: Native file-reference provider

Status: implemented

[English](2026-10-09-native-file-reference-provider.md) | 中文

## Problem

Native profile 需要使用与生效 `read` 工具相同文件系统命名空间的路径发现，同时保留 Cordis 提供方与唯一 Native Session writer。

## Decision

`dsh-file-reference` 拥有不依赖 Cordis 的 Native `NativeFileReferenceOperations` 声明、共用搜索算法、语法和提示词文本。`dsh-native-file-reference-local` 中的 Native Host Provider 通过 `activeSessions` 解析确切 Agent 与 Session，只通过所选 `fs` 服务读取目录元数据，并提供排序后的仅含路径候选。只有 Agent 作用域的模型 schema 中存在 `read`，且所提供的 Session `allowedTools` 列表允许它时，提供方才贡献共用指引。Native Headless 在发布活动 owner 前使用 Session allowlist 渲染提示词，再于 attach 后选取实际请求 schema，以保留 attach 时注册的工具。每个活动 owner 持有一个有界索引；工具结果会让该索引失效，detach 会在移除 Session 监听器前取消并排空已准入读取。Cordis 提供方保留已有服务和宿主文件系统适配器，同时复用共用搜索算法。

## Alternatives considered

**通过宿主 Node 文件系统搜索。** 这可能让发现结果与沙箱化或远程 `fs` Provider 不一致。Native Provider 改为通过所选 `ctx.fs` 实现执行列目录、路径解析、元数据读取和包含关系检查。

**在 Native Provider 内复制搜索算法。** 这会让 Cordis 与 Native 提供方的排序和失效行为逐渐分叉。两个提供方共用纯有界搜索核心，各自只保留命名空间专属 reader 与生命周期所有者。

**读取候选内容或把内容附加到 mention。** 这会绕过面向模型的文件系统工具及其策略。候选只包含路径，模型必须调用生效的 `read` 工具才能使用文件内容。

## Consequences

Native 与 Cordis 提供方保留各自不同的 runtime 和文件系统所有权，同时共用候选排序与提示词指引。没有生效 `read` 工具的 Native profile 仍可发现路径，但不会收到读取文件指令。候选范围由所选提供方的命名空间和有界排除项决定。

## Verification

已发布 `workflow-native` CLI 回放快照在系统提示词中保留 FILE_REFERENCE_PROMPT，并在输出 schema 中包含 `read`。Native 提供方测试覆盖目录项反序时的稳定候选、作用域 `read` 的默认指引、空 Session allowlist 对指引的抑制、所选文件系统的包含关系和 detach 排空。Headless 回归设置 `allowedTools: []`：`read` 仍已注册但不在该请求的有效 schema 中；请求与持久化系统消息均不含指引，用户的 `@README.md` 引用仍保留。提示词不匹配准入回归同时检查 fork 与 scheduled resume；事件流保持不变，不会持久化 fork identity、中断 turn 的 closer 或 scheduled 来源标记。现有 task-scheduler 冷恢复测试确认直接人工恢复时仍能看到 attach 时注册的 `task_schedule`，scheduled root 则继续被拒绝。
