# Agent Note: Native compatibility bridge

Status: implemented

[English](2026-09-22-native-compatibility-bridge.md) | 中文

## Problem

原生 filesystem 和 headless profile 在分阶段迁移期间需要选定的旧 filesystem 实现，但启动旧 bundle 会引入相互竞争的 Agent、工具和 Session 写入者。

## Decision

可选的 `compat-dsh-runtime` 创建一个 Cordis Context，并仅通过 `compatDshRuntime` 服务向选定兼容 bridge 暴露它。bridge 通过 `dsh-plugin-host` 挂载 allowlist 中的插件，由后者持有子 Fiber 和 descriptor 注册。`compat-fs-local` 和 `compat-fs-sandbox` 分别提供 `fs`；sandbox 变体要求选择原生策略。`compat-fs-policy` 将原生 filesystem 事件转发给旧 observation policy，并提供策略权威标记。`compat-tool-fs` 将选定旧工具和提示词 section 注册到原生注册表，而原生 headless 应用校验调用并且只追加一条 Session 结果。

每个 bridge 都会在将所选包挂载为共享 Cordis Context 中的 Loader entry 前校验元数据和配置。Runtime 会在激活前检查精确的 Cordis 4.0.2、Loader 1.0.3 版本，以及受支持的 DSH 包声明。Loader 更新前会排空已接收的原生工具调用和进行中的提示词组装；策略 entry 变更前会排空策略监听器。Bridge 释放时会移除其拥有的原生贡献，Host 关闭时会排空 Context。不含 `compat-dsh-runtime` 的原生安装不会通过此兼容路径加载 Cordis。兼容 profile 通过已发布的 `dsh` 命令运行旧 write 工具，验证 filesystem 变更、模型可见提示词和 schema，以及一条持久结果。[Loader entry 生命周期决策](2026-10-06-native-compatibility-loader-entry-lifecycle.zh.md)记录支持矩阵和 reload 区分。

## Alternatives considered

**加载旧 base bundle。** 它被拒绝，因为其拥有的 Agent loop、Session state 和 tool runtime 与原生权威冲突。

**立即重写选定的旧包。** 它被拒绝，因为分阶段迁移需要在替换阶段前从维护中的 filesystem 实现获得行为证据。

**在策略缺失时让 sandbox bridge 选择本地存储。** 它被拒绝，因为缺少策略必须明确失败，而不是扩大变更访问范围。

## Consequences

原生 profile 可消费选定旧 filesystem 实现，而不产生第二个持久 Session 写入者。兼容层仍限定于已声明包，并保留 Cordis 作为显式依赖。原生策略只有 profile 级 mode，更广的审批、attachment、UI 展示、reload 和 replacement 行为仍由后续迁移阶段负责。

## Testing

桥接的 filesystem 事件为 `fs/observed`（sync）以及 `fs/write-intent` 和 `fs/edit-intent` 两个 waterfall。这些就是 Native 与 Cordis filesystem 领域声明或分发的全部事件；两侧都没有 parallel 或 serial 模式的 filesystem 事件，因此 bridge 没有此类模式需要适配。`compat-tool-fs` 的 waterfall 用例对比原生发起和 Cordis 发起的分发，覆盖监听器顺序、经两侧 `next()` 委托到调用方终端、抛错、短路和异步拒绝；计数终端证明短路与拒绝都不会调用调用方终端。`compat-fs-policy` 用例覆盖原生到 Cordis 转发进入 observation policy；该策略按设计终止 waterfall，而不委托给后续原生监听器。`compat-fs-local` 用例让生产原生 `read` 和 `write` 工具使用 Cordis fs-local Provider，再用 `cwd` 不同的新实例替换该 Provider。它断言替换会以 `FS_ABORTED` 中止旧 backend 上已准入的写入，旧 backend 开始清理时 `fs` 服务尚未发布，清理被挂起期间旧写入的 staging 目录与临时文件仍存在、替身 `fs` 服务首次发布时二者已被删除，清理在替换结算前完成且随后由替身服务下一次读取，保留的旧实例拒绝新 I/O，且移除后 live proxy 报告服务不可用。

桥 allowlist 固定了四个 filesystem 包（`dsh-fs-local`、`dsh-fs-observation-policy`、`dsh-fs-sandbox`、`dsh-tool-fs`）、`dsh-tools` 与 `dsh-system-prompt`，以及内部适配器 `sandbox-policy-adapter`、`fs-adapter` 和 `fs-event-bridge`。工具审批、code runtime、用户提问与 automation 没有 Native 桥（`compat-user-approval` 与 `compat-code-runtime` 是 Cordis 内部插件），因此它们的事件语义只在 Native 侧验证；只有其中某族加入 allowlist 后，Native 与 Cordis 的对照才适用。这些族的 Provider 替换在运行中的 Native Host 内通过 `NativeHost.replace` 完成，生产 Consumer 不变。native-headless 的 PTC 用例让 `run_code` 使用真实 worker-thread runtime，挂起旧 runtime 的清理以证明此前替换既不结算也不激活替身，再按工具调用 ID 断言模型可见结果：真实 runtime 为 `42`，受控替身为 `7`。`tool-ask-user` 用例先在问题待回答时移除委托 answerer，从而取消 broker 展示并持久化 `ASK_ABORTED`；随后在另一问题待回答时把真实 question broker 替换为受控 broker，以同样方式挂起旧 broker 的清理，在替身激活时观察到旧 broker 已 disposed，并由替身回答下一个问题。

`dsh-tools` 与 `dsh-system-prompt` 只作为 `compat-tool-fs` 的支撑服务挂载，因此 Tools 与 prompt 组装以服务而非桥接事件的形式跨桥。Cordis 工具通过 Native `execute` 服务供 Native 调用方使用；Cordis 的 `pre-execute`、`execute`、`post-execute` waterfall 与 Native 的 `aroundExecution`、`postResult` waterfall 各自留在本侧。因此 `compat-tool-fs` 用例对同一次读取，分别在读取成功和文件缺失两种情况下，对照两侧服务返回的内容、错误标志和错误信息。Native `promptSections` 渲染 Cordis `systemPrompt.assemble()` 的输出。该用例对照 Native `prompt.render()` 与 Cordis `assemble()` 的完整提示文本和 `system-prompt/assemble` waterfall 顺序、短路、同步抛错和异步拒绝，两侧都抛出同一个错误对象。`system-prompt/change` 不转发，compaction 也不在 allowlist 中，因此在 compaction 加入 allowlist 之前，其事件只在 Native 侧验证。

在 Native 内部，`native-tools` 生命周期 spec 在两个 sibling Agent scope 中注册同名工具，并发执行一次排队调用和一次 delegated 调用；每次调用都保留各自的 initiator、Agent、Session、parent 与 delegation context。native-headless 的 delegation 用例让生产 Headless Consumer 调用子 Agent scope 中的同名工具，并核对子调用 ID、Session、initiator、SessionExecution authority 与工具授权。

另有两个 native-headless 用例在 Headless 应用持续运行时替换 Provider。Tools 用例把真实 Tools Provider 替换为替身 registry：在途调用被中止且本次 run 以拒绝结算；挂起旧 registry 的清理以证明此前替换既不结算也不激活替身；替身激活时旧 registry 已清空并 disposed；替换前保留的 `execute` 引用被拒绝，且旧工具与替身都不会执行；模型可见结果按工具调用 ID 对照。Skill 用例先通过 `skill-filesystem` 与生产 ToolSkill Consumer 读取真实本地 `SKILL.md`，再把该 Provider 替换为受控 Provider。它挂起旧 Provider 的读取与清理，让在途 ToolSkill 调用以 skill 不可用结算，在替身激活时观察到旧资源已释放，并对照两轮的完整模型请求与持久化工具结果，只允许消息、调用与 Session ID、abort signal 以及两个 Provider 的 Skill 内容不同。去掉对挂起清理的等待后，两个用例都会失败。
