# Agent Note: Native 会话记录其常驻权限事实

Status: implemented

[English](2026-11-09-native-permission-seeding.md) | 中文

## Problem

Cordis 会话到达模型时，其日志中已带有三条持久权限事实：`permission/preset`、`sandbox/mode` 与 `approval/policy`。`PermissionPresetService` 在 `session/created` 时通过 `pinInitialPermission` 写入它们，早于会话发布。

Native 会话一条都不记录。`native-sandbox-policy` 与 `native-approval` 会执行解析后的策略，`native-permission-presets` 也能通过 `apply()` 写入这三条，但仅在用户选择预设时。没有人重新配置的会话不携带管理它的策略的记录：回放无法重建该模式，而与 Cordis 录制的比较会在会话最初三个事件处分叉。

## Decision

Native 权限预设提供方在其确切 owner 挂载时补齐缺失事实。`activeSessions.onAttached` 在初次模型准入之前、并在 `context.effect` 之内把写入方交给提供方，因此观察者会随提供方一同移除。观察者读取一次持久历史，只追加缺失的部分：

- `sandbox/mode` 取自 `sandboxPolicy.resolve({ session })`，与执行工具所用的解析一致
- `approval/policy` 取自已安装的 `approval` 策略
- `permission/preset` 取自已记录组合实际匹配到的预设

已经记录全部三条的会话不受影响，部分初始化的会话只补其缺口，而不匹配任何预设的组合保持 `custom`，不会凭空造出一个名字。已补写 owner 的 `WeakSet` 使同一次挂载不会补写两次。

## Alternatives considered

**改在 `native-headless` 中写入。** 否决。应用拥有轮次，而不拥有权限词汇；Cordis 侧的所有者是权限预设服务，在应用中放第二个写入方会复制预设表并与之漂移。

**分别从 `sandboxPolicy` 与 `approval` 补写。** 否决。这两个提供方执行策略但不拥有预设名，`permission/preset` 将没有作者。从预设所有者补写使这三条只有一个写入方，与 Cordis 的做法一致。

**每次挂载都追加。** 否决。恢复的会话已携带这些事实；再次追加会每次挂载多记一份副本，破坏本改动要恢复的回放等价性。

## Consequences

Native 会话现在记录管理它的策略，其事件序列从第一个事件起就与 Cordis 录制一致。在 `fs-read` 迁移验证中，产出序列由 18 个事件且头部不同，变为全部 21 个事件完全相同。

该补写是组合策略的投影，而非用户意图：它记录部署已经决定的内容，之后的预设选择仍通过 `apply()` 替换它。既未安装 `sandboxPolicy` 也未安装 `approval` 的部署无法组合该提供方——它本就要求两者。

验证：`tests/native.spec.ts` 为新会话补写、对已完整记录的会话不做改动、并只补齐部分初始化会话的缺口。移除补写守卫会使第一与第三个用例失败。
