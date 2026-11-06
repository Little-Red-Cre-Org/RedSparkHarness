# Agent Note: Native `@` 引用 source 读一套投影、两种发现

Status: implemented

[English](2026-11-06-native-reference-source.md) | 中文

## Problem

`ui-reference` 只有浏览器半边。它的 `apply` 通过 `ctx.inputTriggers` 注册 `@` source，经 `remote.fileReferences` 发现文件、经 `remote.sessionReferenceResolver` 发现会话，并在该文件里直接投影行。Native Web 客户端不组合 Cordis 上下文，也没有那对 Remote 命名空间，因此它能够到的 `@` 菜单是空的：在 Native composer 里按 `@` 什么都不会发生。这是迁移在引用侧剩下的唯一能力缺口。

另有两块早已存在，并不是缺口。`ui-input-trigger` 的 Native 入口提供 `clientNativeInputTrigger`——浏览器驱动的同一个 `InputTriggerController`，跑在 Native 分发适配器上；`native-session` 提供 `clientNativeFileReferences.search`，即工作区路径搜索。缺的是一个注册进该流水线的 source。

## Decision

本包现在发布 `./native`，并把行为一分为二。

`src/client/candidates.ts` 拥有行的产出：`fileCandidate`、`sessionCandidate`、`crumbsFor`、`directoryValue` 与 `pickOf`。两半都导入它。它声明自己返回的行、面包屑与 pick 类型，而不从 `@redspark/rsh-client-ui-input-trigger/client` 导入，因为 Native 入口不得触达 Cordis 侧契约；这些声明描述的正是流水线接受的同一批字段。

`src/native.ts` 只提供发现。文件来自 `clientNativeFileReferences.search`；会话来自 `clientNativeConversation` 已经持有的持久化列表，由 `sessionCandidatesFor` 筛选并排序——排除发起会话，与其共享工作区的候选最前，其次是记录了其他工作区的，最后是没有记录的。浏览器解析器在宿主上做这件事；Native 客户端没有宿主可问，于是同一条规则跑在客户端已有的行上。

Native 入口把 `clientNativeInputTrigger` 作为必需依赖，而不是可选。注册进一个没有组合驱动的流水线的 source 会安装成功却什么都不显示，而这正是本次改动要消除的失败。`clientNativeInputTrigger` 又要求 `clientNativeConversation`，因此依赖单向，该行在 `NATIVE_WEB_CLIENT_INSTALLATIONS` 里排在 `input-trigger` 之后。

还有两个较小的事实源于在浏览器中运行：

`session-reference` 的 URI 编解码使用 `Buffer`，浏览器包无法承载，因此 `encodeSessionReferenceUri`/`decodeSessionReferenceUri` 改用 `TextEncoder`/`btoa` 及其逆运算。该包为这个模块发布 `./uri`：根部入口导入 Cordis 服务，而 Native client 包会直接拒绝 Cordis 导入。

显示的工作区按宿主 home 缩写，该 home 每次调用时从连接代次读取，因此重连到另一个宿主会重新读取，而不是一直沿用首次取到的值。

## Alternatives considered

**从浏览器半边自己的模块导入行投影。** 否决：`src/client/index.ts` 导入 `@redspark/cordis` 与 Remote 类型合并，二者都会被 Native 包拒绝。投影必须移到没有 Cordis 边的模块，一旦移出，两半就读同一份。

**两半各留一套行构造器。** 否决：两者会在早前工作已经定下的细节上漂移——根行不写位置、下钻列表省略头部已承载的父目录、会话省略自身工作区。共享模块让分歧变成编译错误，而不是一个必须同时覆盖两边的测试。

**注册 source 但不要求 `clientNativeInputTrigger`。** 否决：`registerSource` 会被调在一个并不存在的服务上。声明该依赖让省略流水线的组合在计划阶段就失败，这正是 [fail-loud 规则](../../../../AGENTS.md) 要求的位置。

**加一条宿主路由，让 Native 客户端调用真正的 `sessionReferenceResolver`。** 否决：`native-web` 不组合 `sessionQuery`（模板只为 headless profile 安装它），而解析器自身的候选列举要读 Web 客户端没有的会话投影。客户端已持有的持久化列表用宿主已经投影过的事实回答了同一个问题。

## Consequences

- Native 输入流水线持有一个 `@` source，回答工作区文件与持久化会话，pick 解析出的插入与浏览器 source 一致。
- **渲染这些行的菜单尚未安装。** `native-application` 的 composer 拥有自己的 `/` 面板，不调用 `clientNativeInputTrigger` 的任何方法，因此 Native 用户此刻按 `@` 看不到东西。source、它的发现面与 pick 结果均可达且有测试；把它们渲染进 composer 的 overlay 是另一件事，在它落地之前，本入口的能力与既有的 `/` 行一样处于潜伏状态。
- 行的文案、顺序与 pick 结果只有一个家，两个构建不会在引用上产生分歧。
- Native 的会话分组弱于浏览器：它从客户端列表排序与取标签，因此标题投影不可用的会话以 id 作标签，而不会付出一次日志读取。
- 宿主解析器的候选上限是按部署配置的；Native 的上限是协议自身的界，因为客户端在提问前读不到那项配置。
- 覆盖：`tests/native-reference.client.spec.ts` 钉住发起会话排除、亲和排序、标题/id/工作区筛选、id 回落标签、带引号路径抑制、搜索失败降级为仅会话分组、中止结果丢弃、跨重连的 home 缩写、下钻头部、每种 pick 结果、codec 往返，以及 plugin 正文（字典、source 注册，以及经注册的 source 读到的 home getter）。
