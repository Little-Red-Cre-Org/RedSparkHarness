# Agent Note: Native 子任务记录委派策略

Status: implemented

[English](2026-11-15-native-delegated-policy.md) | 中文

## 问题

只要组合了审批，Cordis 就把被委派子任务的审批钉成 `never`，并且只复制父级显式的沙箱覆盖。Native 子任务以前不记录这个钉定。只读父任务委派出的子任务，日志里可能既没有固定的沙箱模式，也没有已关闭的审批策略。

## 决定

`captureDelegatedPolicy` 在子任务第一次等待之前读取父级。沙箱值来自 `explicitSandboxMode`，也就是原生沙箱策略保存的最新 `sandbox/mode`。父级从未记录时则省略。只有该回合的 `delegationAuthority.approvalRequired` 为真时，才写入 `source` 为 `delegation` 的 `approval/policy` `never`。安装审批服务时，Native headless 会设置这个标志。

一次性子任务在描述符之后、从 `initialize` 写入这两条事件。可持续子任务在维护阶段写入，位于描述符之后、收件箱消息之前。Native headless 渲染运行时上下文的审批句时，先读该 Session 最新的 `approval/policy` 事件，否则用已安装的审批策略。因此即使部署策略是 `ask`，子任务钉定也会告诉模型审批提示已关闭。

已发布的 `native-sdk` 不安装审批。可持续继承回放会安装策略为 `ask` 的 `@redspark/rsh-native-approval`，因为所录制的 Cordis sdk 组合包含审批。Cordis 规则见 [审批钉定为 never](../feature/2026-08-10-subagent-approval-pinned-never.zh.md)。

## 考虑过的替代方案

**给每个 Native 子任务都钉定审批。** 拒绝。没有审批服务的部署没有可关闭的审批授权，写入 `never` 会造出父级并不执行的策略。

**父级日志没有 `sandbox/mode` 时复制部署沙箱模式。** 拒绝。Cordis 只捕获显式的 Session 覆盖。没有事件时，部署默认值仍是子级解析的后备。

## 后果

只有父回合拥有审批授权时，精确子日志才会增加这个钉定。`snapshots/native-sdk/text-turn` 安装了审批，因此现在记录钉定和“审批提示已关闭”这句话。`snapshots/native-headless/workflow-native` 禁用了审批，子日志保持不变。不含审批的 profile，包括已发布的 `native-sdk`，不会多出 `approval/policy` 事件。Session 上的审批覆盖会改变下一条运行时上下文快照。
