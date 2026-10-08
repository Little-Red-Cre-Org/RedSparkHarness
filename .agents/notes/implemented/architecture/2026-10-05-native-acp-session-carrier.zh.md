# Agent Note: 原生 ACP Session 承载层

Status: implemented

[English](2026-10-05-native-acp-session-carrier.md) | 中文

## 问题

显式 `native-acp` profile 必须提供标准 ACP 传输，同时由 Engine 独占 Agent、Session writer 与模型轮次。其安装声明必须在 Session 可用之前覆盖承载层调用的全部 Engine 操作。

## 决策

原生 ACP 应用使用持续维护的 ACP SDK 校验线路并处理标准输入输出分帧，使用共享 `native-headless` 执行模型、Agent、工具与 Session 工作。Host installation 要求原生 `activeSessions` Provider，因为 `session/new` 会在确认之前通过 Engine root maintenance 创建空的持久化 Session。如果缺少该 Provider，installation planning 会在应用激活之前拒绝承载层；承载层不会另建持久化或 Session writer 路径。

每个 ACP Session 拥有一个 Engine executor、一个 branded route、一个 cancellation controller 和对应协议资源。Root execution 先解析精确挂接的 root Agent 与 Session，再通过该 route 分发；新建的 Engine Session identity 可以不同于 ACP wire id。Admission 会拒绝 foreign、delegated、released 和 closing owner。Owner closing 时，精确 owner 的 `capture` 与 `cancel` 仍可用，使清理过程能在 Engine detach 前取消并排空已接收工作。必需的 `releaseIdle` 操作按选定 route 委托；Engine 仅接受已准入动态 Workspace route 上已结算 owner 的 retirement，ACP 的 per-Session base route 不属于此类 route。此 profile 未配置动态 Workspace 准入，因此不提供可选的 `createWorkspaceRoute` 能力。Live executor 关闭后，持久化仍保留 durable Session log。

承载层接受标准文本与图像提示、已声明的模型控制、stdio 与 Streamable HTTP MCP 工具连接以及 permission requests。模型选择与权限结果仍绑定到精确 Session owner。兼容 `acp` profile 仍是默认组合；`native-acp` profile 需要显式选择。

输入 EOF 与 Host cancellation 会停止 admission、取消已接收工作，并排空模型初始化、permission requests、协议资源和 executor teardown。只有来自已中止 execution signal 的完全相同 reason 才映射为 ACP cancelled response；清理失败和其他 execution error 仍作为协议错误。原生承载层不提供 ACP question requests、attachment presentation、MCP resources 或 prompts、audio 或 embedded-context input，也没有 shutdown request。该 profile 未启用动态 workspace selection；标准 `session/new` 与 `session/resume` 负责选择并验证 Session workspace。

## 考虑过的替代方案

**由协议层自建 Agent loop 或 Session writer。**不采用，因为这会重复 Engine 的 execution admission、durable writer 与 owner 生命周期。

**保持 `activeSessions` optional，并直接通过 persistence 创建空 Session。**不采用，因为每次创建都必须经过 Engine root maintenance；独立 persistence 路径会破坏唯一 Session owner。

**声明完整 ACP 对等能力。**不采用，因为客户端依赖能力声明后，缺失的交互与展示通道仍可能失败。原生 profile 保持显式选择，并只声明其支持的输入。

## 影响

ACP 客户端可以通过受支持的启动器操作持久化的原生 Session，无需启动 Cordis。协议 Session id 与 Engine root Session id 仍是经由 owned route 关联的不同 identity。现有生命周期覆盖使用构建后的 launcher 和本地受控模型服务器，并使用确定性 adapter 检验原生 Engine 组合；它证明协议与生命周期行为，但不证明已认证 Provider 推理。缺失 Provider 的规划回归证明 installation 在激活前拒绝不完整组合。
