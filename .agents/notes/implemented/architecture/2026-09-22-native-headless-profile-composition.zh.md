# Agent Note: 原生 headless profile 组合

Status: implemented

[English](2026-09-22-native-headless-profile-composition.md) | 中文

## Problem

原生 Host 库能够安装插件，但不能通过受支持的 `dsh --profile` 入口启动用户任务、执行真实工具或持久化 Session。仅在测试中合成 Host，无法证明 profile 发现、文件系统效果、关闭流程与已发布 Session 存储能够协同工作。

## Decision

显式 `dsh.profile.runtime: "native"` 标记选择带版本号的 JSON profile。安装项列出包、作用域、id 与完整配置值；有序 JSON patch 只替换既有安装项。CLI 在导入插件入口前校验所有选中包的原生元数据，拒绝非空 Cordis patch 层，并通过 `NativeHost.run()` 启动恰好一个应用。

原生 headless 应用在原生文件系统与观察策略 Provider、既有 Session 事件格式、JSONL 后端及原生模型流服务之上拥有最小单轮 agent。它将两个文件工具限定在配置的工作目录内，在下一次模型请求前记录模型可见输入与工具结果，并在退出前刷新及关闭存储。续接时异步读取持久历史，拒绝已改变的工作目录和系统提示词设置，并记录完整的续接请求头。Session 构造时向调用方报告新追加的 seed 标记，后续事件直接从 append 返回值收集，不同步扫描 Session 历史。失败或中止的轮次通过 Session 中断修复补齐未完成工具调用，再关闭步骤与轮次。

## Alternatives considered

**启动私有测试入口。** 这样会绕开此切片需要验证的公开 CLI、profile 标记、包元数据检查和关闭路径。

**通过 Cordis 启动原生安装项。** 这样会创建 Cordis Context，并让原生 Host 依赖兼容解释器。原生 profile 使用独立的严格 JSON 解析器，拒绝未经转换的 Cordis patch。

**在原生应用中复制完整 agent loop。** 这会在相应服务定义迁移前复制工具注册表、审批策略及更广泛的产品语义。应用仅暴露证明真实执行与持久化所需的文件操作。

## Consequences

公开 CLI 能运行具备真实文件效果及已发布 Session 数据的原生 profile，同时保留 Cordis profile 行为。最小应用有意窄于 Cordis headless 组合；它没有审批、SDK、Web 或通用工具注册表。Session 与 JSONL 包在此阶段仍包含 Cordis 导入，但原生执行路径不会构造 Cordis Context。[迁移提案](../../proposed/architecture/2026-09-22-rsh-native-runtime-and-optional-cordis.zh.md)跟踪后续兼容及依赖工作。

## Verification

已构建的 `dsh` profile 测试使用真实文件系统、观察策略、JSONL 及应用包，仅替换外部模型。它检查文件内容、持久日志续接、中止，以及一旦构造 Cordis Context 就抛错的加载器探针。直接组合测试检查空文件写入、工作目录拒绝、Session 续接及模型结束行为。
