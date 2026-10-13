# Agent Note: Native ACP child runtime

Status: implemented

[English](2026-10-13-native-acp-child-runtime.md) | 中文

## 问题

Native Subagent 可以消费外部 driver，但 ACP child 不承载 Engine 所有的 SDK Session 协议或模型操作 broker 事实。适配器也不能自行选择可执行文件、子 profile 或进程 policy。

## 决策

Official `dsh-acp-child` 适配器消费 `NativeExternalSubagentDriver` 与 `NativeAcpChildRuntime*` Service Definition。CLI 提供 launcher，并且只启动同版本的 `native-acp-dsh-child` profile。父级 profile 必须显式安装此适配器；随附的 `native-sdk` 和 `native-acp` profile 不会选择它。

CLI 从最近可见的 pi-ai Provider 派生非机密路由目录。适配器的 `providerName` 标识外部 driver，`providers` 则按精确模型路由的 provider 键控。Native Subagent 可在父级准入下选择与父模型路由不同的 child 提供方/模型；子进程在接收提示词前必须保留这一精确选定的 child 路由、可选推理强度、已接受的 step/token 上限和协商的权限模式。适配器接受文本和图像提示，并返回不透明 ACP 文本；它不使用 Engine `request.model` Responses transport，也不发布六类 `subagent/external-operation` broker 事实。

launcher 不接受调用方选择的可执行文件或任意 argv，会显式注入所选路由凭据，要求 child 的规范 cwd 位于父级 workspace 内，并从子 profile 移除 Native Subagent 与 workflow Provider。它只在精确的父级审批 relay 与获准的内建 `write_file` 具备父级 `workspace-write` 权限时派生 `workspace-write` child policy，否则派生 `read-only`。获准写入时，规范化后的 `workspaceWriteRoot` 必须等于父级 sandbox workspace root。child 文件写入仍必须同时具备精确 approval identity、要求审批的父级、`workspace-write` 权限以及获准的内建 `write_file`；否则子进程没有写入工具。runtime 保留后端报告的 `full` 或 `partial` 文件操作强制执行级别。Windows ACL 强制执行级别为 `partial`，且不限制读取、网络访问或进程可见性；后端不可用或 runner 失败时不会回退为不受限启动。详见 [sandbox-local policy](../../../../rsh/Modules/Official/sandbox/sandbox-local/README.zh.md) 和 [Windows ACL 限制](../../../../rsh/Modules/Official/sandbox/sandbox-windows-acl/README.zh.md)。关闭过程会先结算整个受管进程范围，再移除私有 DSH_HOME。

## 后果

- ACP 保持为可选的不透明 child 路由；它不声明 SDK Session、Responses 或 Native 操作 broker 语义。
- CLI 所有固定 profile 的进程启动，父级 Native Session 仍是路由、权限和审批权限的来源。
- Windows recorded-session snapshot 通过构建产物启动固定 child，并在独立 workspace oracle 下记录/回放一次由父级批准的 `write_file`。它核验父级和 child 的持久审批 identity、路由上限、零 external-operation 事实，以及进程/私有 home 清理。平台矩阵与完整验收仍待完成，因此 ACP 仍是 opt-in 候选；当前限制由包 README 维护。

## 考虑过的替代方案

- **复用 SDK child runtime**——拒绝，因为 ACP 保留独立的 child 协议并返回不透明文本，而不是 Engine 所有的 SDK Session 和操作流。
- **让 Official 适配器选择可执行文件和 argv**——拒绝，因为 CLI 必须所有同版本 profile 选择和整个进程范围的清理。
- **在随附 profile 中启用适配器**——拒绝，因为此路由缺少这些 profile 预期的 Native Responses 与 broker 事实；Windows recorded-session snapshot 已覆盖一次父级批准的文件写入，完整平台验收仍待完成。

## 相关决策

- [Native SDK 外部子任务 runtime](2026-10-08-native-sdk-external-child-runtime.zh.md)记录 SDK child 的所有权与协议语义。
- [Native 外部子 agent driver 所有权](2026-10-08-native-external-subagent-driver.zh.md)记录共享 Native driver seam。
- [Native 外部操作 broker](2026-10-10-native-external-operation-broker.zh.md)记录六类 broker 事实。
