# Agent Note：原生 Agent 所有的后台 job

状态：已实现

[English](2026-09-23-native-agent-jobs.md) | 中文

## 问题

原生 Host 已有 Agent 标识与工具审批，但没有不依赖框架的方式来保留长期操作、将它限制给 owner、请求取消，并在 Host 释放 Provider 前排空它。复用 `ctx.jobs` 会把旧有 service、scope 和 Agent 权威重新引入原生 profile 执行。

## 决策

`@deepseek-ai/dsh-native-jobs` 在 `agents` 之后提供 `jobs`。它只在精确登记的 `NativeAgent` 下启动，分配带 kind 前缀的 opaque id，保留私有可变记录，并返回分离的 snapshot。读取、等待和取消都会重复精确对象检查。早先 Agent 注销后，即使后来的 Agent 具有相同 id，也不能观察之前的 job。

runner 会得到协作式 `AbortSignal` 并 resolve 一个显式终态 outcome。同步 throw 或 rejected runner 会变为失败 job 记录，而 `cancel()` 只请求取消，最终 outcome 仍以 runner 为准。注册表释放会阻止新接收、abort 每个存活 runner 并等待它们完成。Agent 释放会让 owner 变为不可用、abort 并排空其存活 runner，之后才触发配对的 Agent 释放事件。job 不拥有 Session writer 或模型渲染；未来投影原生 shell、subagent 或 workflow 工作的应用拥有有界输出与持久化事件。

原生 Agent 释放现已接收 Host 的取消信号。Host 关闭会在拥有的 Provider 排空前关闭事件接收，因此余下的 Agent 条目会在不向已关闭 bus emit 的情况下释放；普通显式注销仍会触发配对生命周期事件。

## 考虑过的替代方案

**在原生应用中使用旧 JobRegistry：** 这会创建第二套运行时权威，并要求 Cordis Agent 与 scope 对象。

**只按 Agent id 授权：** 早先 Agent 退出后 id 可以复用，因此会向替代标识泄露或让其取消旧工作。

**把取消当作强制终态：** shell、worker 或远程 subagent 可能在 abort 请求后才结束；记录人为结果会错误描述工作的 outcome。

## 结果

Provider 有显式的每 Agent 并发配置，但没有浏览器、RPC、工具 schema、Session 或进程 kill 层。原生 producer 必须让 runner 配合取消，并引入自己包含模型可见结果的 Session projection。旧 `dsh-jobs` 会继续供 Cordis profile 使用，直到后续默认装配阶段。

## 验证

原生 Host 测试覆盖完成与输出读取、精确 owner 隔离、启动前并发拒绝、显式取消、Host 释放排空、手动 Agent 释放时在生命周期事件前的取消与排空，以及事件接收关闭后的剩余 Agent 清理。
