# Agent Note: Native SDK 外部子任务 runtime

Status: implemented

[English](2026-10-08-native-sdk-external-child-runtime.md) | 中文

## 问题

P4 外部 child adapter 需要真实 SDK Session 与 turn 协议，同时必须保留所选 Program 作为唯一 Agent、Session writer、launcher 与子进程范围所有者。Native Module 不能反向导入 Program client 来启动自身，也不能把同名自定义工具误作父级内建权限。

## 决策

唯一的 TypeScript SDK 协议 runtime 与 Session API 放在 `rsh/Engine/subagent/sdk-runtime`。Programs 保留公开的 `@deepseek-ai/dsh-sdk-client` facade 及其同版本 `resolveDshLaunch` 实现。opt-in Native profile 安装一个固定 Program launcher capability。Module 只能通过该能力请求一个所选 provider/model 路由；它得不到任意 executable、argv、profile、patch 或完整父环境。

Profile loader 在应用用户 overlay 后，从实际选中的 `pi-ai` installation 派生 child provider map。child adapter 只通过 Host credentials service 解析被选配置的 `apiKeyEnv`，并将该 key 发送给固定 child 进程。已存储的 OAuth 与 credential 记录明确不支持。模型目录仍由 provider 拥有。

同版本 CLI 只有 source entry 时，SDK 会按已校验的 profile runtime marker 决定是否传入 Cordis source patch。CLI package metadata 中的 `nativeProfileTemplates` 是唯一 shipped Native profile registry，供 template writer 与 SDK launcher 共用；自定义 profile 名称遵循其 manifest marker。

父文件权限来自 `NativeSessionDelegationAuthority.builtinToolNames`，Native Headless 会将它与模型可见 Plugin 工具分开构建。读取使用继承的 Session cwd。只有父快照授予确切内建 `write_file`、父级要求审批、策略提供已解析 workspace-write 根，且所选 `dsh-sdk` driver 持有绑定当前 owner、epoch 与 turn 的 callback 时，child 才能获得写工具。固定私有 launcher 只为该 relay 添加 Native Approval `ask` provider；其他 child 组合不含该审批 provider。SDK 请求携带 operation、request、child Session 与 tool-call 身份。仅既有 parent approval authority 写入持久 asked／decided 事件；SDK transport 只传递问题与决策。取消、超时、owner 退役与关闭会取消 relay；await 后的重新校验会拒绝迟到结果。child 进程沙箱限制文件副作用，托管进程范围排空后删除私有 DSH_HOME，Windows enforcement 按 backend 实际情况报告 partial。

## 后果

- Engine runtime 保持 framework-neutral，并拥有唯一 SDK transport/session 实现；Engine 与 Module 均不反向依赖 Programs。
- Programs 保留受支持的默认 SDK launcher 与 opt-in 固定 Native child launcher。普通 `native-sdk` 组合不变。
- child 只接收有来源证明的 Headless 内建文件权限。父级批准的写入仅通过绑定精确父级的 operation-scoped 审批 relay 支持；自定义工具过滤、persona 和结构化输出仍不支持。
- `maxTokens` 继续表示每次请求上限。Native `maxSteps` 会在 initialize 握手期间协商并限制到 profile 上限，然后才发布就绪；现有 Headless loop 会在后续 child turn 执行时强制该上限。

## Alternatives considered

- **将协议 runtime 留在 Programs**——未采用，因为 Engine 与 Native Module 消费方会向上依赖 Program SDK client。
- **另建 child 专用协议 client**——未采用，因为第二套握手与 Session 实现可能偏离公开 TypeScript SDK。
- **允许 Module 选择 executable 与 argv**——未采用，因为 Program 和 Host 必须保留启动策略与进程范围所有权。

## 验证边界

受控 model-server fixture 验证进程启动、所选路由继承、真实 initialize 握手、现有 step-limit terminal event、取消／排空与内建文件权限。它不能证明在线 provider OAuth、动态目录刷新、订阅登录或网络推理。
