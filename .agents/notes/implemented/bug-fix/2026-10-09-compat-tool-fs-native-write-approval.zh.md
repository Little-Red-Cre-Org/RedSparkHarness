# Agent Note: 兼容文件变更的 Native approval

[English](2026-10-09-compat-tool-fs-native-write-approval.md) | 中文

Status: implemented

## 问题

兼容文件系统 bridge 将旧 `write` 和 `edit` schema 注册为 Native contribution，却在调用 Cordis 工具前没有请求已选 Native approval owner。因此，Native `never` 策略没有保护这些旧名称的变更操作。

## 决策

选择 Native `approval` 后，bridge 会在旧 `write` 或 `edit` 未同时提供两个 sandbox escalation 字段时，先调用已准入 invocation 的 `call.authorize`。NativeTools 将请求绑定到仍存活的 Agent、Session、call ID 和取消 signal；Native 应用拥有持久 asked/decided 事件。bridge 将授权与执行作为同一个 active call 跟踪，使 Loader suspension 能排空两者。撤销入口中止调用时，排空跟踪只把与 signal reason 完全相同的错误视为预期取消，原始 rejection 仍会传给 Native 调用方；提示词和其他工作失败仍会使 suspension 失败。

同时提供 `sandbox_permissions` 和 `justification` 的调用仍走旧 sandbox escalation 路径。bridge 不会再安装一项 approval 服务或审计 store。未提供 Native approval Provider 时，普通兼容变更沿用原有行为。

## 已考虑的替代方案

**为每个变更 contribution 添加固定 approval metadata。** NativeTools 会在旧工具读取参数前询问，因此显式升级操作可能先出现通用询问，再进入独立的旧 approval 路径。bridge 改为根据现有参数选择普通授权。

**挂载 Cordis approval service 或增加适配器自有审计记录。** 这会重复 Native 应用的授权权威与持久审批记录所有权。现有 NativeTools callback 已携带当前 invocation 的归属信息与 signal。

## 后果

普通兼容写入和编辑遵循已选 Native approval 策略；遭到拒绝或缺少授权权威时，不会进入旧变更工具。读取仍不询问。显式 sandbox escalation 保留旧 approval 要求，并在缺少该旧 approval service 时 fail closed。bridge 不创建额外的 Session 事件。

## 测试

兼容集成用例以 `write` 和 `edit` 分别覆盖 `never` 与 `ask`，检查实际文件结果，以及同一持久 Session 中的 Native asked/decided 事件。禁用旧 tool-fs Loader entry 时，会取消第二个仍在等待的 `ask` write；写入正文不会运行，entry 保持撤销，重新启用后 contributions 恢复。现有未安装 Native approval Provider 的 write/edit 用例固定无 Provider 时的原行为。
