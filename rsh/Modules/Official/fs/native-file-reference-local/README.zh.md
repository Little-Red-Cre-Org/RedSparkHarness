---
description: "通过所选文件系统服务提供仅含路径的工作区文件发现的 Native Host Provider。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-file-reference-local

[English](README.md) | 中文

## 概述

`dsh-native-file-reference-local` 通过所选 `fs` 服务提供 Native 文件引用候选。它将发现范围限定到确切的活动 Agent 与 Session owner，只公开路径；只有该 Agent 的作用域 `modelSchemas` 中存在 `read`，且 Session allowlist 未将其排除时，才会贡献稳定模型指引。它不会读取候选内容，也不会直接访问宿主文件系统。

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

将此 Native Host Provider 与所选文件系统 Provider、活动会话 registry、工具 registry 和提示词段 registry 一同安装。它的 `dsh.native` 声明要求这四项服务并提供 `fileReferences`；它不会安装或选择文件系统后端。

`fileReferences.list(agent, session, query, signal)` 只接受某个活动会话 owner 所持有的确切 Agent 与 Session。它返回按确定性顺序排序的工作区相对路径和目录，不读取文件内容。所选 `fs` 服务负责列目录、元数据检查、规范路径解析和包含关系检查，因此替换后端仍使用其自己的命名空间。

只有当 Agent 作用域的 modelSchemas 中存在 `read`，且提供的 Session `allowedTools` 包含它时，提供方才安装 FILE_REFERENCE_PROMPT。Native Headless 将该 allowlist 作为提示词约束传入；模型请求 schema 仍在活动 owner attach 后选取。用户选中的路径仍是普通消息文本；模型必须调用其生效的 read 工具才能使用文件内容。

每个 owner 的索引受 `maxEntries` 限制，默认值来自共用排除项和候选数常量。`tool/result` 事件会将该 owner 的索引标记为陈旧。detach 会取消已准入查询、排空文件系统读取并释放 Session 事件监听器；Provider 关闭时会排空所有剩余 owner。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/native.ts`](src/native.ts) | Native Host Provider、确切 owner 查找、提示词注册与按 owner 释放 |
| [`../../../../Engine/context/file-reference/src/native.ts`](../../../../Engine/context/file-reference/src/native.ts) | 不依赖 Cordis 的 `NativeFileReferenceOperations` 声明 |
| [`../../../../Engine/context/file-reference/src/search-core.ts`](../../../../Engine/context/file-reference/src/search-core.ts) | 共用的有界遍历与确定性排序 |
| [`../../../../Engine/context/file-reference/src/prompt.ts`](../../../../Engine/context/file-reference/src/prompt.ts) | 与 Cordis 提供方共用的稳定模型指引 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [文件引用约定](../../../../Engine/context/file-reference/README.zh.md)——候选形状、语法与 Native 服务声明。
- [文件系统包组](../README.zh.md)——所选 `fs` 提供方与面向模型的工具。
- [文件系统子系统](../../../../Docs/subsystems/filesystem.zh.md)——文件系统目标身份、元数据与包含关系语义。
- [Native 文件引用决策](../../../../../.agents/notes/implemented/architecture/2026-10-09-native-file-reference-provider.zh.md)——共用搜索的所有权与生命周期依据。

-----

<a id="model-experience"></a>
## 模型体验

### 文件引用指引

#### 模型看到的内容

当目标 Agent 拥有生效的 `read` 工具时，提供方会增加以下稳定系统提示词段：

##### 文件引用指引

```markdown
Tokens prefixed with @ are workspace paths the user explicitly referenced, relative to the workspace root. A trailing slash marks a directory: list it when its contents matter. Anything else is a file: use the read tool when its contents are needed, and do not claim to have inspected it before reading. @"..." quotes a path containing spaces.
```

#### Token 影响

当 `read` 可用时，指引增加一个稳定提示词段。候选发现不会增加提示词内容，提供方也不会读取或附加文件内容。

#### KV Cache 影响

当 `read` 可用时，稳定段会加入系统提示词前缀；候选查询与索引状态变化不会改变该前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下是当前包的约束。

- **命名空间跟随所选文件系统**：候选与 `fs` 提供方使用同一命名空间；若面向模型的 `read` 工具使用其他命名空间，就需要匹配的提供方。
- **有界建议索引**：被排除的目录和超过 `maxEntries` 的条目不会被提供；`.gitignore` 文件不会改变遍历范围。

**运行时不变量：** 每个 owner 的搜索索引只是可丢弃的建议性缓存，并非独立持久关系，因此不发布 invariant companion；文件系统结果和活动 owner 身份仍以所选 `fs` 与 `activeSessions` 服务为准。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
