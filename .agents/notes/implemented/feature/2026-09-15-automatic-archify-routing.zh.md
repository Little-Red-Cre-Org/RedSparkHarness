# Agent Note: Automatic Archify routing

Status: implemented

[English](2026-09-15-automatic-archify-routing.md) | 中文

## 问题

Harness 用户需要经过校验的架构与运行链路产物，但不应为普通代码和讨论任务手动安装独立 profile 或持续承担提示词上下文成本。Archify 已拥有类型化规格、校验、渲染器、示例、viewer 资源和 CLI。在 Harness 中重新实现这些内容会形成第二个维护 owner；而暴露宽泛的模型可见 Skill 目录项会改变每个符合条件请求的前缀，并引入误触发使用。

## 决策

`@deepseek-ai/dsh-archify` 是发布的 `skill/` 插件，也是 `@deepseek-ai/dsh-base` 的直接依赖。它固定 `@tt-a1i/archify-dsh@0.1.0`，通过包 manifest 解析已安装的 `SKILL.md`，并暴露一个内置 `archify` provider。上游包拥有指令正文、schema、诊断、渲染器、示例、viewer 与 CLI。Harness 拥有 provider、路由策略、包版本、profile 组合和兼容性覆盖。

provider 使用 `{ modelInvocable: false, userInvocable: true }`。因此通用模型目录与 `skill` 工具既不公布也不加载它，而已有的直接 `/archify` 手势仍然可用。插件在 `dsh-base` 中早于 `dsh-tool-skill` 注册，因此显式手势仍是最终注入指令，自动选择不会与之重复。

自动监听器只在 `agent/pre-step` 中读取已领取的直接用户文本，至多扫描可配置的 `maxUserTextChars`，并要求可配置动作和图表短语族同时命中。它原样返回普通请求，忽略所有非用户来源文本，并跳过任意直接 `/archify` 手势。命中后会携带轮次 abort signal 解析胜出的 scoped Skill，并追加一条带类型 `archify-auto-invocation` 来源的渲染指令消息。这会通过已有 `user/message` 事件让选中的上游正文对模型可见且可持久化，同时不改变 `agent-loop`、Session 格式版本、SDK、工具、presenter、凭据或沙箱策略。

Archify 命令仍使用已有 shell、文件系统、权限和 `present` 能力。agent 校验候选文件、运行上游交付，并通过 `deliverables/presented` 记录已接受 JSON 与 HTML；不存在 Archify 专用工具或客户端卡片。

provider 会把已解析的上游目录作为受管理的 `DSH_ARCHIFY_SKILL_DIR` 提供给已有 shell 工具。渲染后的指令列出已安装 JSON 资源，并要求通过 shell 定位，因为代码 worker 不会继承这些逐次执行时提供的环境变量。独立命令保留用户工作区为工作目录，并以受管理变量为包内资源添加前缀。委派任务携带相同指引；PATH 查找与仓库搜索不能判断可用性。指令正文不包含机器专属包路径。

## 考虑过的替代方案

**保留私有 opt-in profile bundle。**未选择，因为用户必须在产品帮助之前知道该包和 profile 生命周期，尽管上游载荷已足够稳定，部署自有路由规则也很小。

**把部分上游源码复制进 Harness。**未选择，因为它会 fork schema、诊断、渲染器、viewer 和测试，却没有独立 Harness 交互能证明第二个实现 owner 合理。

**新增原生 `archify_validate` 和 `archify_render` 工具。**未选择，因为当前 shell 与交付表面已经提供所需权限和 Session 行为。新增工具 schema、Service Definition/provider/consumer 角色、Session 事件、SDK 投影和 presenter 会重复已有行为。

**通过通用目录向每个模型公布 Archify。**未选择，因为其摘要会改变每个带目录请求，模型发现也可能选择错误工作。隐藏的确定性路由让普通请求保持不变。

## 验证

包测试覆盖隐藏 provider 发现、未匹配与非用户绕过、自动注入、显式调用、部署控制、持久化 agent-loop 指令、真实 profile 启动、失败保留以及 `present` 记录。shell 回归从独立 Unicode 工作区执行渲染后的命令，读取清单中的 JSON 文件，并检查 showcase 交付。无密钥 `archify-auto-routing` headless 快照通过 `dsh --profile headless` 使用自有 PowerShell 请求头基线回放注入指令。这些检查不能证明真实模型已完成 Godot 分析，也不能替代人工视觉审查。

## 后果

所有基于标准 base 的 profile 都获得同一低开销能力，包括 Desktop 通过其 base-bundle 运行时闭包获得该能力。普通请求只执行有上限的内存文本检查；它们既不读取上游 Skill，也不会获得 Archify 目录项或指令。用户始终能使用 `/archify` 选择精确行为，部署也能通过后续 profile patch 禁用自动选择或替换短语列表。上游校验之后的视觉质量仍由人工检查，升级仍是显式依赖变更，并执行同一套路由、loader 和产物验收。
