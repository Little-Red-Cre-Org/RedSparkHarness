# Agent Note：原生定时根任务

状态：已实现

[English](2026-10-06-native-scheduled-root-work.md) | 中文

## 问题

兼容层调度器保存持久计划，但原生 profile 无法通过选定的 Program 执行到期任务，同时避免建立第二套 Agent 或 Session 写入者。定时请求也不能继承管理工具并递归创建计划。

## 决策

`task-scheduler` 包在已有 SQLite 计划和执行记录存储之上提供原生 Provider 与模型工具 Consumer。所选 Program 的 `rootExecution` 服务捕获创建者不可变的执行路线，并拥有每个到期的根 Session。每个随附的交互式原生 profile 使用独立数据库。到期任务先开启空闲根事务，移除继承的任务管理能力，再通过相同根执行权运行提示。Program 会在发布两个 owner 之前持久化一个可忽略的 `session/root-origin` 记录，并将该分类暴露在活动 owner 上。因此即使进程在维护完成、prompt 接纳前停止，Provider 替换和冷恢复后仍会禁止计划任务 Session 使用交互式管理。结果写入独立的持久 Session；完成记录只证明 Agent 回合已结束，不证明工作正确。

原生计划保存路线及已解析的执行配置。启动时逐个检查已存路线仍指向相同配置，随后才允许到期任务运行。兼容层计划使用 Agent 和权限预设，原生 Provider 不会接管。中断记录保留而不重放，因为中断前可能已经产生外部效果。原生 Goal 续跑和个人提醒投递在各自 Provider 就绪前不可用；原生工具不提供这些模式。

Cordis gateway 会加载 `@deepseek-ai/dsh-typert-protocol`，公开 Client 声明也引用其 `RemoteResult` 类型。原生入口不使用该协议，因此它对原生消费者是可选 peer；安装本包的兼容 profile 必须提供该协议。

## 考虑过的替代方案

**在原生 profile 中运行兼容层 Agent 循环：** 否决，因为这会产生第二套执行权和 Session 写入权。

**从已保存的模型与工作区重建路线：** 否决，因为重启后部署策略和提示配置可能静默变化。

**自动重放中断任务：** 否决，因为模型或工具可能已经产生外部效果。

## 后果

调度器作为可选安装出现在 `native-web` 与 `native-tui` 的首次使用组合中。已有的用户 profile 文件保持原样。原生 SDK 与 ACP profile 也组合了原生根执行器，但未安装或验收调度器；通用 SDK 工具结果投影不会安装定时任务管理能力。

## 验证

定向原生 Host 场景覆盖到期计划、独立持久 Session、仅维护时在发布 owner 前保存来源、Provider 替换与冷恢复、防止递归管理、无需模型请求的所有者管理、取消以及规范工具结果。配对的 TypeScript 与 Python SDK 用例确认可忽略来源事件保留在运行结果投影中。Profile 模板与原生依赖检查覆盖安装元数据和无 Cordis 的入口依赖图。
