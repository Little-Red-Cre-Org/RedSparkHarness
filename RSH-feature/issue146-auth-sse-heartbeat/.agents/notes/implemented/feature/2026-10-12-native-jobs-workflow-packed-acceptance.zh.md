# Agent Note：Native Jobs 与 Workflow 打包验收

Status: implemented

[English](2026-10-12-native-jobs-workflow-packed-acceptance.md) | 中文

## 问题

原生 Jobs registry、控制工具、spawn Subagent Provider 以及 Workflow Consumer/provider 均已存在。单元测试和生命周期测试无法证明独立安装的 CLI 能解析这些包、走通应用路径，或在关闭后保留可冷读取的所属 Session 事实。现有 native-headless snapshots 使用仓库 CLI 和 workspace 链接包，因此不属于独立打包消费者证据。

## 决策

在所属的 `native-headless` CLI profile 测试目录中添加两个可选启用的真实应用夹具。两者都通过 Node 启动已打包的 `dsh` 可执行文件，使用 `--profile native-headless`、全新的 `DSH_HOME`、本地 SSE 模型夹具和普通已安装包依赖，并清除继承的 `NODE_OPTIONS` 与 `NODE_PATH`。当前 base（`989c172`，含 PR #207）中的全新 native-headless 模板会将启动目录记录为应用 `cwd`。夹具仍通过受支持的 `--patch` 覆盖为隔离的临时 `cwd` 和本地模型配置，使每个测试拥有独立 workspace。此测试隔离 override 不是对旧模板缺失的绕过。每个夹具都等待 CLI 进程结果，然后从磁盘读取 Session JSONL，而不是查询运行时 registry。

Workflow 夹具经过面向模型的 Workflow Consumer、选定的 `worker-thread` Provider 和 spawn Subagent child；它验证持久化的 workflow start、child end、run end 事实顺序以及返回的 child text。Jobs 夹具经由原生工具 Consumer 和共享 Jobs registry 启动两个真实后台 spawn Subagent，取消其中一个并等待取消完成；随后从持久 Session 观察兄弟 job 仍在运行，再等待其完成。它从冷读取 parent 和两个 child Sessions，并检查持久化 control 结果与终态 turn。

打包 Jobs 夹具以打包 CLI 的 `--dump-config` 输出为起点，只向临时用户 profile 添加已存在的 `@deepseek-ai/dsh-tool-subagent` Consumer。它等待两个 child model streams 就绪，然后通过有界的面向模型 `job_output(wait:false)` probes 重复读取，直到 live output 和 `running` 状态同时出现在所属 Session 与后续 model request 中；只有确认后才取消 alpha。这是基于状态的观察，不依赖延时。当前随附的 `native-headless` 模板已经选择原生 Jobs/control 包和 `spawn` Provider，但没有面向模型的该 Consumer。因此，默认 profile 可以提供 Jobs controls 和 Workflow，却无法接受模型直接请求的 Subagent spawn，除非由其负责人更新 profile 组合。本批记录这一缺口，不修改只读 CLI 模板。

## 证据矩阵

| 表面 | Profile 与执行路径 | 证据 | 限制 |
| --- | --- | --- | --- |
| Workflow | 独立安装的打包 `dsh`、Linux x64、`native-headless`、本地 SSE 模型、worker-thread Provider、spawn Subagent | 进程退出以及冷读取的 parent/child JSONL，包含有序 workflow 与结果事实 | 一个平台、一个选定 Provider；不代表支持 external Codex/Responses 或 continuable |
| Jobs | 同一打包 `dsh` 和平台；临时 profile 添加现有 Subagent Consumer | 一个 Agent/Session 路径中的两个 job；一个取消、兄弟仍运行并完成；冷读取 parent 和 child JSONL | 随附默认 profile 的缺失仍存在；持久化 lineage 可识别 child Sessions，精确 owner fencing 另由 Jobs 单元测试覆盖 |
| Owner 与 dispose | 既有 `native-jobs`、`native-tool-jobs` 和 `workflow-worker-thread` 原生测试 | 精确 Agent ownership、registry/control 行为及由屏障控制的原生 dispose 路径分开覆盖 | 打包夹具记录 `dsh` 进程退出；不声称独立观测每个 child 的 OS process/Worker |
| 包消费 | 与 lockfile 对齐的本地包 tarball，正常 package install scripts，存在原生 addon | 包清单、tarball hashes、安装结果、进程和 Session 证据记录在配套 workspace evidence ledger 中 | 标准 release-family pack cycle 在产出 family 前失败；按包打包的 fallback 不认证发布顺序或完整标准 verifier |

Native-headless CLI 使用 root Session id 派生 Agent id；持久化的 parent/child Session 关联与 job start 元数据是有用的 owner lineage，并非直接运行时 introspection。精确 live-Agent fencing 与 teardown 顺序仍由所属单元和生命周期测试确立。

## 考虑过的替代方案

- **在本批中把缺失的 Subagent Consumer 加入随附 native-headless 模板：**拒绝，因为默认 profile 组合不属于本批所有权范围。受控 profile 能在不悄悄改变默认值的情况下证明现有 Provider/registry 路径。
- **复用 workspace 链接 snapshot 或手动组装 Native Host：**拒绝，因为两者都不能证明已安装 CLI 和普通 package 解析；直接构造 Host 还会绕过应用接线。
- **为夹具添加专用 Jobs registry 或 Session writer：**拒绝，因为这会重复权威，而不是测试现有 Agent-owned registry 和 Program-owned Session。

## 命令与复现

配套 evidence ledger 记录完整命令、工作目录、Node/platform、退出码、最终 base/head、已安装 tarball 身份与 SHA-256、进程结果以及冷 Session 文件。final-head 全量 build 尝试以 137 退出（aggregate exit 1）。定向 artifact 准备只重建 CLI 与 `llm-pi-ai`；其余 324 个 DSH tarball 中的 322 个复用了 commit `61a19bcd576e498313b3e2cc73d0329604a1514e` 的产物。这些定向产物不能证明全量 build 成功，也不能证明 final-head 完整发布家族已构建。原始 `tsx` launcher 失败与定向重建所用的受支持 Node ESM loader 调用均有记录。`pack.ts --family dsh` 的 release-family 失败及其 dependency-cycle 诊断同样保留。与 upstream 最新 Koffi 的原生编译失败分开，另行记录了使用 lockfile 对齐的 `koffi@3.1.1` 的消费者安装。

验收刻意限定在 Linux x64 上选定的 `native-headless` `spawn` 路径；临时 `cwd` 仅用于隔离测试 workspace。它不代表支持其他 profile 或平台、external API provider、external-driver background/continuable 执行、跨 CLI invocation 的长时任务，也不代表缺少面向模型 Consumer 的随附 headless profile 已支持直接 spawn。

## 结果

现在的应用级证据可在不引入第二套 Agent loop、registry、Session writer 或默认 profile 的情况下走通真实打包 CLI。后续 profile 组合工作如需支持 headless 模型直接请求 spawn，应在相应 profile 中添加 Subagent Consumer，并保留现有 Native Jobs registry 和 owner 关系。
