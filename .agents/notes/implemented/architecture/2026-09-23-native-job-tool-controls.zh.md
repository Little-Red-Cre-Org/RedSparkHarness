# Agent Note：原生任务控制工具

Status: implemented

[English](2026-09-23-native-job-tool-controls.md) | 中文

## 问题

原生任务注册表可以拥有并排空后台工作，但原生应用尚未选装供模型读取或取消这些工作的控制工具。复用 Cordis 的 `tool-jobs` 会把其 Agent、工具和 Session 权威带入原生 profile。等待操作也不支持调用方取消，Host 关闭可能因此一直阻塞到较长的任务输出超时结束。

## 决定

`@deepseek-ai/dsh-native-tool-jobs` 向选定的原生工具注册表贡献 `job_output`、`job_list` 和 `job_kill`。这些工具使用应用传入的精确 Agent 和选定的原生任务注册表；应用在唯一的 Session 日志中记录调用与结果。此包不启动任务。移除该安装时，仅注销这些贡献。

任务注册表的 `wait()` 接受调用方信号。信号中止时，等待会拒绝并移除定时器和监听器，不取消底层任务。`job_output` 应用已验证的默认超时与上限，并传入工具调用的信号。每条模型可见结果都有配置的 UTF-8 字节上限；截断后的输出保留省略标记和任务状态。`job_kill` 请求取消并报告这一请求；runner 完成后的结果仍是权威。

## 考虑过的替代方案

**复制旧版 `tool-jobs` 实现：** 它依赖 Cordis `ctx.tools`、旧版 Agent 归属和完成消息投递，会在一个原生 profile 中形成两套权威。

**把任务工具放进 headless 循环：** 这会让单个应用拥有通用任务能力，阻碍其他原生应用选装相同的控制工具。

**读取等待中止时取消任务：** 调用方可能停止等待，但独立工作仍有价值。任务取消应使用单独的显式操作。

## 结果

原生 headless profile 现在安装任务注册表和控制工具；模型可以调用这三个工具。任务仍由 Agent 拥有，单次运行的应用在每轮结束释放 Agent 时会取消并排空任务。原生 shell、subagent 与 workflow Producer 仍需各自接入可运行的实现。原生注册表仅保留最终输出，因此 `job_output` 不是增量流读取接口，空闲 Agent 也尚未收到完成通知。

## 验证

原生 Host 测试覆盖登记和释放、所有者隔离、列出／读取／取消、参数拒绝、有界 UTF-8 输出，以及取消等待但不取消任务。构建后的 `dsh --profile native-headless` 无密钥快照验证模型可见 schema、实际 `job_list` 调用、其持久化工具结果及同一 Session 内的后续执行。
