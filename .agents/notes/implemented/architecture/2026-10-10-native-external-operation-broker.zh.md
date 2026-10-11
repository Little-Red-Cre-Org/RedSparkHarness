# Agent Note: Native external-operation broker

Status: implemented

[English](2026-10-10-native-external-operation-broker.md) | 中文

## 问题

外部产品可以在 Native Session loop 之外发起模型可见请求并接收响应。仅有父级启动和结束事实无法重建这些请求或结果，逻辑子步骤也无法约束 provider 重试次数。

## 决策

脱离 Native 对象的外部驱动请求携带由 `NativeSpawnSubagents` 所有的窄模型操作能力。Engine 只为捕获的活跃父级、调用根所有者和已解析路由准入模型请求。每次出站尝试都会在首次等待之前同步预留，并等待 `subagent/external-start` 事实刷新后才继续；重试会消耗新的预留，单个操作最多只能预留 `maxSteps` 次。超过上限会锁存 fatal error、取消既有操作、排空子范围与尝试，并记录错误结束事件且不发布成功结果。

每次准入尝试都会在转发前记录完整的已解析 Responses 请求。产品暴露或重试结果前，会通过捕获的父级 writer 记录完整 SSE 事件序列、终态响应或失败，以及从该响应解析出的精确工具调用投影。取消或所有者替换后收到的响应仍会作为实际事实记录，但在交付前会被拒绝。失败结算使用捕获的 writer，并始终释放 lease；writer 失败会保留为 sticky drain failure。Lease 身份绑定单个操作且只能结算一次。

同一次捕获的 `NativeExternalToolOperations` 快照提供直接工具 schema、程序 schema、prompt 文本、工具执行和延迟 Native 接受。Engine 只为该响应已记录的解析调用创建一次性 grant，写入 `tool-call` 和完整 `tool-result`，再接受捕获结果并写入带 settlement contexts 与 `concludesTurn` 的 `tool-settlement`。settlement 持久化后，捕获的 Headless 附件服务只解析该已接受结果及其 settlement contexts 中的图片引用并返回已验证字节；capture dispose 会排空这些读取。当前 attempt 或上一响应任一工具尚未结算时，后续推理会被拒绝；任一 settlement 结束 turn 后也会拒绝后续推理。过早的推理请求不会取消已接受的工具调用。正常完成时，子范围和已接受工具流水线先排空，再释放捕获；取消时会先释放捕获以停止工具 body，再排空 settlement。

取消开始后，Headless 只允许追加 `tool/ptc-dispatch` 结算，以持久化每个已启动 PTC 调用必需的错误结果；PTC 启动和其他事件写入仍受 abort guard 限制。

Official Responses driver 使用 Engine 从选定的精确预备模型调用捕获的借用传输。路由匹配时复用该代际；显式更改路由时仅按所选 provider 与 model 预备一次。产品释放以及已接纳的模型、工具和审批工作排空后，由 Engine 关闭传输。父级设置 `maxTokens` 上限时，捕获代际必须能执行该上限，gateway 会校验最终投影的 `max_output_tokens`；缺失或不支持该能力会在 child 启动前拒绝。嵌套 Responses 调用继承绑定到确切外层预备代际的进程内能力。路由匹配时从该代际独立捕获传输；provider/model 明确变化时只为 child 预备一个代际，不改变 parent。每个 child 独立拥有自己的传输，并由 Engine 在产品释放和已接纳工作排空后关闭。

序列化器只编码 JSON 值。产品 adapter 必须先解析并筛选 wire 请求，并确保事件不包含 headers、credentials、environment 和上游 URL。Engine 不向 adapter 提供 Agent、Session、Context 或 writer。

## 考虑过的替代方案

**把 Native 所有者或 Session writer 交给产品 adapter。** 这会让 adapter 直接追加模型历史，但会越过产品边界转移 Program 拥有的身份与持久化权限。Engine 因此只提供操作范围内的回调，并通过捕获的所有者写入事件。

**用逻辑子步骤作为请求上限。** 产品可以在单个逻辑步骤内重试，因此该计数无法限制出站尝试。Engine 将每次尝试（包括重试）计入 `maxSteps`。

## 后果

`subagent/external-operation` 是 required-on-read Session 事件。其变体保留 `model-request` 路由与请求体、`model-response` SSE 事件/完成响应/精确 `toolCalls`、`model-failure`、带名称和参数的 `tool-call`、`tool-result`，以及带 contexts 和 turn 结论的 `tool-settlement`。标准持久化 catalog 会收录它，不改变 Session envelope 版本，也不重写已提交的 Session 世代。无密钥快照身份映射器只将此事件的 `parentEpoch` 与 `rootEpoch` 归一化为稳定的首次出现 epoch token，并保留重复身份关系。无密钥快照规范化器还只将数值顶层时钟归零：`subagent/external-start` 的 `data.startedAt`、六种 `subagent/external-operation` 变体的 `data.at`，以及 `subagent/external-end` 的 `data.finishedAt`；嵌套同名时钟字段保持不变。Official Native Codex driver 消费 Engine 捕获的预备代际传输，但没有已交付的 Provider 提供 `nativeResponses`，因此相关请求仍会在产品启动前失败。实际 provider Responses transport、Codex 产品执行以及 TypeScript、Python SDK 事件投影仍未验证且属于发布依赖；下文脚本场景不能证明这些能力或 P4 验收。

Host 依赖策略只将 `JsonRpcLineTransport` 和 `disposeChildConnection` 分类为可跨重复安装使用的出口：前者的可变状态属于各自的 transport 实例，后者的状态属于每次调用。策略不分类 `JsonRpcResponseError`；跨 package copy 的 `instanceof` 检查不保证成立。

策略还将 Codex app-server 对 `ToolCallId`、`fileHandleText` 和 `serializeNativeExternalJson` 的导入标记为必需 Host peer 出口；消费者依赖要求见 [Codex app-server README](../../../../rsh/Modules/Official/subagent/codex-app-server/README.zh.md)。

定向 `external-driver.spec.ts` 用例验证首次准入等待启动事实刷新、请求和响应事件持久化、尝试上限触发取消，以及排空先于错误结束事件。其嵌套 Responses 用例使用 `NativeModelExecution` 验证同路由保留代际、路由改变只预备一次，以及 parent 代际仍保持不变。`external-tools.spec.ts` 的 Responses 用例验证模型选择改变后仍保留原预备代际，close 会拒绝新工作、等待已接纳响应 body 与 Provider 清理，并撤销嵌套捕获 factory。Native Headless 回归用例通过真实 PTC `run_code`、`tool-subagent` 和嵌套 Responses 调用执行工作，在嵌套转发已接纳后取消 parent，再冷读 PTC 启动与错误结算的配对，并验证产品释放先于传输关闭。该测试使用脚本化 adapter 与外部 driver；普通 turn appender 的对称行为仅经源码审查，且该用例不替代已发布 CLI 快照重放或真实 Provider Responses 实现。两调用工具用例会暂停第一个 body，验证过早的后续推理不会取消已接受调用、每个 durable result 先于 Native 接受与 settlement，并验证 `concludesTurn` 会在正常完成结束前阻止后续推理。定向 dsh broker 场景使用 mock model 和 scripted external driver：首次尝试失败后重试，执行真实文件系统写入，记录结果及 `settlementContexts` 为空的持久化 settlement，再进行下一次推理。Cold JSONL 重放与完整 workspace oracle 对照。该场景未覆盖非空 settlement contexts 或取消。
