---
description: "通过 CLI 固定的同版本子进程 launcher，选择可选的 Native 外部子 agent ACP 路由。该路由用于有界文本与图像任务，所选 child 路由和文件权限仍受父 Session 管辖。"
kind: "package-reference"
---

# @deepseek-ai/dsh-acp-child

[English](README.md) | 中文

## 概述

通过 CLI 所有的固定 launcher，为 Native 单次子任务选择 `dsh-acp-child` 路由。Native Subagent 可准入与父模型路由不同的 child 提供方/模型；子进程必须保留这一精确选定的 child 路由、可选推理强度和已接受的执行上限。ACP 返回不透明的子任务文本，不提供 Responses transport 或 Native 操作 broker。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

仅在显式 Native profile 安装项中选择此包；随附的 `native-sdk` 和 `native-acp` profile 不会选择它。

### 何时选择

当 Native 父级需要独立 ACP 子进程、子进程请求对父级操作 broker 保持不透明、文件权限由精确的父 Session 决定时，选择此路由。若子进程必须使用 Engine 所有的 SDK transport，请改用 [Native SDK child](../sdk-child/README.zh.md)。

### Native profile 安装项

将此安装项加入可见 pi-ai model Provider 的 Native profile；CLI 会从该 Provider 提供 `providers` 路由目录。仅安装此项不会选择该 driver：必须让现有 Native Subagent Provider 与 workflow Consumer 选择相同的 driver 名称。

```json
{
  "id": "acp-child",
  "plugin": "@deepseek-ai/dsh-acp-child",
  "scope": "root",
  "config": { "providerName": "dsh-acp-child" }
}
```

| 现有安装项 | 配置字段 | 值 |
|---|---|---|
| `subagents`（`@deepseek-ai/dsh-native-subagent`） | `providerName` | `dsh-acp-child` |
| `workflow-worker`（若已安装） | `subagentProvider` | `dsh-acp-child` |
| `ralph-tool`（若已安装） | `subagentProvider` | `dsh-acp-child` |

workflow tool 的 `provider` 保持为所选 workflow engine。`tool-subagent` Consumer 直接使用所选 Native Subagent Provider，没有单独的 backend-provider 字段。

| 字段 | 要求 | 含义 |
|---|---|---|
| `providerName` | 必填 | 本包注册的精确外部 driver identity；它不是模型提供方路由。 |
| `providers` | CLI profile 解析后必填 | 按最近可见 pi-ai Provider 中各精确 `route.provider` 条目键控的非机密路由目录；所选 child 路由必须匹配目录条目并命名 `apiKeyEnv`。 |

Native profile loader 会拒绝缺少可见 pi-ai Provider 或路由目录为空的情况。Provider 项不能包含 `apiKey` 或自定义 `headers`；Host credentials Provider 会解析所选环境变量名称引用。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节——点击展开</summary>

`src/runtime.ts` 中的 Service Definition 描述所选路由、父级 policy、子进程生命周期和固定 profile launcher。`src/native.ts` 消费该 launcher 并注册 ACP driver。CLI 在 [Program Provider](../../../../Programs/CLI/src/native-acp-child-runtime-launcher.ts) 中提供 launcher，并由 [Native profile loader](../../../../Programs/CLI/src/native-profile-loader.ts) 解析路由目录。

| 源文件 | 职责 |
|---|---|
| [`src/runtime.ts`](src/runtime.ts) | `NativeAcpChildRuntimeRequest`、`NativeAcpChildRuntime` 与 `NativeAcpChildRuntimeLauncher` Service Definition |
| [`src/native.ts`](src/native.ts) | Official ACP Consumer 与 Native 外部子 agent driver |
| [`src/index.ts`](src/index.ts) | 包的公开导出 |
| [CLI launcher](../../../../Programs/CLI/src/native-acp-child-runtime-launcher.ts) | 固定子进程运行时的 Program Provider |
| [CLI profile 模板](../../../../Programs/CLI/src/native-profile-template.ts) | 不包含递归子进程提供方的固定 `native-acp-dsh-child` composition |

CLI 使用固定的 `native-acp-dsh-child` profile 和私有生成 patch 启动同版本 `dsh` 可执行文件。请求不携带可执行文件或任意 argv。子 profile 移除 Native Subagent 和 workflow Provider，因此子进程不能再启动 child。launcher 会显式注入所选路由凭据，要求 child 的规范 cwd 位于父级 workspace 内，并为本次运行创建私有 DSH_HOME。

driver 将文本和图像提示块转换为 ACP，然后要求子进程声明并接受精确选定的 child 提供方/模型、推理强度、step/token 上限和权限模式。无法保留选定路由或不高于请求上限的子进程，会在发送提示词前失败。结果仅包含不透明 ACP 文本；driver 不使用 Engine 的 `request.model` Responses 能力，也不发布六类 `subagent/external-operation` 事实：`model-request`、`model-response`、`model-failure`、`tool-call`、`tool-result` 和 `tool-settlement`。

子进程只接收父级授权的 builtin 文件工具。只有当精确子进程权限请求匹配父级 approval identity、父级要求审批、父级 policy 为 `workspace-write` 且该 builtin 已获准时，才保留 `write_file`；否则子进程使用 `deny` 权限模式且不含写入工具。获准写入时，规范化后的 `workspaceWriteRoot` 必须等于父级 sandbox workspace root。launcher 只在该写入权限获准时派生 `workspace-write` child policy，否则派生 `read-only`，再将其交给共享的 `dsh-sandbox-local` ProcessSandbox。child 保留后端报告的 `full` 或 `partial` 强制执行级别。该级别描述文件操作强制执行，不代表完整的进程隔离。Windows ACL 后端报告 `partial`：Everyone 访问与 NTFS 硬链接别名仍是相关限制，且后端不限制读取、网络访问或进程可见性。若无可用后端或 runner 失败，启动会失败且不会重试为不受限运行。详见 [sandbox-local 策略与强制执行](../../sandbox/sandbox-local/README.zh.md) 和 [Windows ACL 限制](../../sandbox/sandbox-windows-acl/README.zh.md)。

关闭过程会先关闭 ACP 与 child stdio 工作，并等待整个受管进程范围结算，然后 `dispose()` 才移除私有 DSH_HOME。本包不发布 runtime invariant companion，因为它没有可独立比较的注册表或持久身份：Native Subagent 负责准入和父 Session 写入，launcher runtime 负责进程清理，因此本包不导出 `./invariant`。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Subagent 子系统](../../../../Docs/subsystems/subagent.zh.md)——Native 外部 driver 的所有权与运行时类型。
- [CLI profile](../../../../Programs/CLI/README.zh.md#profiles)——Native profile 文件与 composition。
- [ACP policy 协议](../acp-protocol/README.zh.md)——带版本的权限与执行上限元数据。
- [Native Subagent 包](../../../../Engine/subagent/native-subagent/README.zh.md)——父级准入与 Session 权限。
- [Native 外部操作 broker 决策](../../../../../.agents/notes/implemented/architecture/2026-10-10-native-external-operation-broker.zh.md)——Engine 记录的外部操作。

<a id="model-experience"></a>
## 模型体验

间接地通过 Native Subagent 路由，该路由会通过委派工具调用返回子进程的不透明输出。

#### KV Cache effect

每次启动的 child 都使用独立 ACP Session；此适配器不会复用或改变父级请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

ACP 路由受子服务协商的能力和父 Session 权限约束。

- **提示词与结果**——接受文本和图像；其他提示块类型会失败，子进程只返回不透明文本。
- **模型操作**——该路由没有 Engine 所有的 Responses transport，也不会发出六类 `subagent/external-operation` 事实。
- **文件访问**——只有精确的父级 approval relay 与 `workspace-write` policy 都成立时才提供 `write_file`；否则子进程没有写入工具。
- **验收**——Windows recorded-session snapshot 通过构建产物启动固定 child，并在独立 workspace oracle 下记录/回放一次由父级批准的 `write_file`。它核验精确的 child 权限元数据与 allow-once 响应、父级和 child 的持久审批 identity、各模型路由的 token 上限、不产生 `subagent/external-operation` 事实，以及受管进程/私有 home 清理。平台矩阵和 ACP 整批验收仍待完成，因此此集成仍是 opt-in 候选。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护上下文——点击展开</summary>

CLI 所有的运行时接口与 ACP policy 元数据分开声明；CLI launcher 只启动固定的同版本 profile。[外部 driver 所有权决策](../../../../../.agents/notes/implemented/architecture/2026-10-08-native-external-subagent-driver.zh.md)和[操作 broker 决策](../../../../../.agents/notes/implemented/architecture/2026-10-10-native-external-operation-broker.zh.md)分别记录其设计理由。

</details>
