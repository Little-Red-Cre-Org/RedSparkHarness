---
description: "将明确的架构与图表交付需求自动且有上限地路由到固定版本 Archify Skill（技能）的能力，供配置或排查 DeepSeek Harness 的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-archify

[English](README.md) | 中文

## 概述

Archify 会把明确的直接用户架构与流程图请求路由到隐藏的固定版本 Skill 和 CLI。自动加载要求动作词与图表词在配置的完整观察上限内同时命中；超限输入不会自动路由。Cordis 用户和安装了手动 Skill Consumer 的 Native TUI profile 也可通过 `/archify` 调用。

包根入口仍是 Cordis 兼容入口并导出 `Config`；Native Host composition 必须显式安装 `./native`，导出入口本身不改变默认配置。两个入口共用路由与资源指引；Native 需要 `skills`、`shellEnv` 和 `requestContexts`。

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

标准 `dsh-base` bundle 会在 `dsh-tool-skill` 之前挂载本包，因此受支持 profile 无需单独安装 profile 就能路由符合条件的需求。

### 何时选择

当 agent 只应在用户明确要求生成、绘制、导出或交付类型化架构或运行链路产物时，保留默认配置。普通解释、代码与讨论需求不会进入路由。若请求刻意省略了路由的动作词或图表词，请使用 `/archify` 显式加载；若部署只希望人工调用，请 patch `autoInvoke: false`。

### 最小配置

随附 Cordis base 行不需要配置。后续 profile patch 可以调整路由，而无需修改上游载荷；Native composition 将相同字段传给 `./native`。

```yaml
- id: archify
  name: '@deepseek-ai/dsh-archify'
  config:
    autoInvoke: true
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `autoInvoke` | `true` | 在匹配的直接用户请求之后自动注入 Archify 指令。 |
| `maxUserTextChars` | `4096` | 自动路由能完整观察的直接用户字符数上限；更长输入不符合自动加载条件。 |
| `requestPhrases` | 内置列表 | 让请求符合自动加载条件的动作短语。 |
| `diagramPhrases` | 内置列表 | 必须与一个动作短语同时出现的图表领域短语。 |

生成的[配置目录](../../../../Docs/config-catalog.zh.md#deepseek-aidsh-archify)是所有可接受字段的完整来源。

### 可观察的成功与失败

加载后的指令列出已安装的 JSON schema 与示例，并要求在创作前通过 shell 定位资源。`DSH_ARCHIFY_SKILL_DIR` 属于 shell 环境，而非 `run_code` 的 `process.env`。独立可执行的 Bash 与 PowerShell 示例读取包内资源并运行 CLI，同时将候选文件和输出路径保留在用户工作区。委派图表任务时必须携带相同的资源指引。PATH 中没有命令并不代表内置 CLI 不可用。

匹配请求会贡献一条 `archify-auto-invocation` 指令消息，并在该步骤让上游正文对模型可见。两个入口的消息来源使用相同公开类型；详见 [Skills 子系统参考](../../../../Docs/subsystems/skills.zh.md#automatic-archify-invocation)。隐藏 Skill 因为禁止模型调用而不会出现在 `dsh-tool-skill` 目录中，Cordis `/archify` 仍允许用户调用。Native TUI composition 也可路由 `/archify`，前提是安装 Archify `./native` 入口和 Native `dsh-tool-skill` consumer；仅导出入口不会改变默认配置。本包不会自行运行 CLI：加载后的指令要求 agent 创建候选文件、校验它、交付 JSON 与 HTML，并对已接受产物调用 `present`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

两个入口都会注册一个内置 `archify` provider，并仅在去除 frontmatter 后懒读取已安装 `@tt-a1i/archify-dsh@0.1.0` 的 `SKILL.md` 正文。provider 公布 `{ modelInvocable: false, userInvocable: true }`，因此既有直接调用可以加载它，而通用模型目录不能公布它。两个入口都会通过已有 shell 工具以受管理的 `DSH_ARCHIFY_SKILL_DIR` 提供已解析的上游目录；渲染后的指令使用该变量，不会暴露绝对安装路径。

Cordis 入口注册在 `agent/pre-step`。它最多完整观察已领取的直接用户消息文本块中的 `maxUserTextChars` 个字符；只要有任何直接用户文本会被截断，即使已观察前缀包含两个短语族，也会放弃自动路由。只有动作短语与图表短语都命中的完整有界观察才会触发，并且直接 `/archify` 手势总会跳过自动加载。命中后会携带 agent scope 与 abort signal 解析胜出的 Skill，再追加带类型 `archify-auto-invocation` 来源的 `createUserMessage`。

`./native` 入口是无 Cordis 的 Host 插件，会安装相同提供方与 shell 环境贡献者。启用 `autoInvoke` 时，其 `requestContexts` 提供方使用相同的完整观察规则，携带 request scope、owner Session cwd 与 abort signal 解析 skill，再返回带相同来源类型的 user message。未匹配请求不会加载上游 Skill 正文。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Cordis 入口、提供方注册与自动指令路由。 |
| [`src/native.ts`](src/native.ts) | 无 Cordis 的 Native Host 插件与 request-context 路由。 |
| [`src/shared.ts`](src/shared.ts) | 共用配置 schema、隐藏提供方、资源指引与有上限的匹配器。 |
| [`src/types.ts`](src/types.ts) | 自动调用消息的公开来源类型。 |
| — | 未发布运行时不变量 companion，因为此插件只会在检查同一条已认领的直接用户消息后写入一条带来源的指令，不存在可独立观测且可能发生偏离的关系。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [skill 子系统参考](../../../../Docs/subsystems/skills.zh.md)——provider 优先级与调用策略。
- [tool-skill 包](../tool-skill/README.zh.md)——通用模型目录与直接 `/name` 加载路径。
- [Present 工具](../../fs/tool-present/README.zh.md)——生成工作区文件的持久交付。
- [Archify 上游](https://github.com/tt-a1i/archify)——复用的 schema、校验、渲染器、viewer 与 CLI。

<a id="model-experience"></a>
## 模型体验

### 条件性 Archify 指令

#### 模型看到什么

以下 Session 日志与请求前缀说明针对 Cordis 入口；Native 入口会在请求准备期间通过 `requestContexts` 提供相同的有界匹配与消息来源。只有完整且未超限的匹配直接用户请求会把渲染后的上游 `<skill_content name="archify">` 块作为 `archify-auto-invocation` Session 消息加入上下文。隐藏 provider 不会添加通用目录条目或工具 schema。

#### Token 影响

未匹配请求增加零个 Archify token。匹配请求会为这个已准入用户批次加入一次完整的固定上游指令；直接 `/archify` 则经由 `dsh-tool-skill` 加载同一正文。

#### KV Cache 影响

未匹配请求保留此前请求前缀。匹配或直接调用会追加一条用户指令消息，因此从该点起请求使用不同前缀；上游依赖或路由配置变更会改变之后的匹配请求。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

这些限制定义当前的路由与交付边界。

- **短语路由刻意严格**——缺少任一已配置动作或图表短语，或超过完整观察上限的需求不会进入自动路由；需要其他受控触发条件时，请使用 `/archify` 或配置短语列表。
- **交付仍由 agent 负责**——本包注入指令，但不运行 Archify，也不发布每个生成路径；agent 必须完成校验并使用已有 `present` 工具。
- **上游视觉保证仍由人工负责**——固定 CLI 能校验类型化产物，但视觉完成度仍需要上游 visual-check 流程，并在该流程不可用时由人工审查。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
