# Agent Note: Native Web 读取并修改 composer 模式与权限

Status: implemented

[English](2026-10-12-native-web-composer-controls.md) | 中文

## Problem

Native Web composer 需要读取 agent mode、plan mode 与常驻权限策略的当前值和可用选项。Host 已拥有 agent-preset 选择、plan-mode 状态机和持久化权限事件，但选定的 Native Session Consumer 没有提供这些读取接口，只有既有 agent-preset 修改接口。

## Decision

经过身份验证的 Native Session API 位于[Host controller](../../../../rsh/Programs/Web/api/native-web-session-controller/src/native.ts)，提供 `session/mode-controls`、`session/select-plan-mode`、`session/permission-controls` 和 `session/select-permission`。位于[native-session](../../../../rsh/Programs/Web/client/native-session/src/native.ts) 的 Cordis-free Client 提供 `modeControls`、`selectPlanMode`、`permissionControls` 和 `selectPermissionPreset`，并在返回前解码每种响应。

Mode 读取通过确切 root Session owner 和完整事件日志折叠所选 preset、持久化修订号与永久的首轮锁定状态。Host 只公布已安装的 preset。Mode 变更继续使用 `session/select-preset` 和 `rootExecution.selectPreset`，遵循 [Native Web model-controls 决策](../architecture/2026-10-05-native-web-model-controls.zh.md)；root executor 负责修订比较、空白 Session 规则和 Agent epoch 替换。Plan-mode 读取包含已安装 Provider 的已记录状态与待应用状态。Plan-mode 变更调用 [plan-mode](../../../../rsh/Modules/Official/plan/plan-mode/src/native.ts) 中 Provider 的既有状态机：空闲时立即记录 `plan/mode`，否则等到下一次接受的 step 再应用；参见[共享 plan-mode 决策](../architecture/2026-10-08-native-session-title-and-plan-mode.zh.md)。

权限读取和写入通过确切 root owner 调用 [permission-presets](../../../../rsh/Modules/Official/interaction/permission-presets/src/native.ts) 中的 `NativePermissionPresetOperations`。Provider 根据所选部署默认值及 `permission/preset`、`sandbox/mode` 和 `approval/policy` 事件解析有效选项。当前策略与某个已配置 preset 匹配时返回该值；无匹配时报告仅供当前显示的 `custom` 选项。选择通过同一组既有事件写入，不会消费或回答待处理的一次性审批。

随附的 `native-web` 模板会安装 plan-mode 和 permission Provider，以及 `standard` 和 `minimal` 常驻 agent preset。profile 可以省略这些可选 Provider，并返回文档说明的不可用响应；模板不会重写用户已有的 profile 文件。

Host 将 plan-mode 和 permission Provider 保持为可选项。缺少 plan-mode Provider 时返回 `available: false`；缺少 permission Provider 时返回无当前选项且选项列表为空的不可用值。缺少 preset Registry 时仍可读取当前 mode 事实，但不公布可选 preset。修改失败使用既有 Native Session RPC 错误封装。

## Alternatives considered

**新增 composer 设置存储。** 这会重复持久化 Session 的权威状态，并导致恢复后的 Session 与 Host 持有的 preset、plan-mode 和权限事件折叠结果不一致。

**用一次性审批回答修改常驻权限。** 审批回答只授权绑定到提示标识的一个待处理操作，不能表示 Session 持续使用的 sandbox 和 approval 策略。

**在 Web controller 中重写 preset 或 plan 选择。** 既有 root executor 拥有 preset 锁定与 epoch 替换，plan-mode Provider 拥有待处理 step 的时序与说明消息。复用这些权威会保留其既有行为。

## Consequences

选定的 Native Client 可以读取所有 composer 控件，而不拥有第二份设置或 Session 缓存。Agent preset 变更仍仅适用于空白 Session。Plan-mode 选择保留已记录状态与待应用状态的区别。权限策略变更保持持久化，并独立于待处理人工审批。随附的 native-web 配置通过同一 Client API 提供 mode 和 permission 选项；其他 profile 可以省略这些可选 Provider。

## Verification

从 CLI 全新启动 `native-web` 后，可通过经过身份验证的 `/api` RPC 读取两种控制项：mode 选项为 `standard` 和 `minimal`，plan mode 可用且未激活；permission 选项为 `workspace-write` 和 `danger-full-access`，当前选中 `workspace-write`。

经过身份验证的 Native Web Host 场景检查当前模式和可用选项，通过两个已提交状态修改 plan mode，读取并修改权限 preset，并通过既有修订检查路由修改 agent preset。该场景使用真实 Provider 和 Session executor，而非平行存储。
