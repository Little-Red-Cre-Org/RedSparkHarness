# Agent Note: Native 凭据 service 通知

Status: implemented

[English](2026-10-14-native-credential-service-notifications.md) | 中文

## 问题

Native 凭据 Provider 在自身 scope 发出 `credentials/record-updated`。Native 事件只会投递给其 scope 包含派发 scope 的监听器，因此子级消费方收不到父级 Provider 的提交。authorization 随后报告 `NOT_COMMITTED`，`llm-pi-ai` 则保留过期的账户路由状态。

## 决定

Native 记录通知属于所选的 `credentials` service 实例。`NativeCredentials.onRecordUpdated` 只传带品牌的记录 key。Provider 在持久化写入、删除或采纳外部变更后同步调用监听器；它会隔离并记录监听器失败，不等待异步工作。其幂等 disposer 会停止新投递并排空已开始的回调，Native 消费方通过 `context.effect` 注册它。

Native authorization 消费方会在凭据写入返回前同步标记 `observedCommit`，并在 flow 返回后继续检查 `describeRecord`。LLM 消费方使用同一个所选 service 失效其 adapter 并刷新账户路由。Cordis 保留 `credentials/record-updated` 事件，Native 引用通知继续使用原有事件路径。

## 考虑过的替代方案

**扩大 Native Runtime 事件可见范围。** 让父级派发到达子级监听器会改变所有 Native 事件的可见范围，而此缺陷属于 credentials capability。

**延后或等待监听器回调。** 延后回调会让凭据写入先于 authorization 观察到提交而返回；等待异步监听器则会把持久化写入结果绑定到 adapter 刷新等消费方工作。

**把消费方移到根 scope。** 这种做法会掩盖不匹配，也忽略了按 scope 实际选中的 credentials Provider，包括更近的 shadowing Provider。

## 影响

Native 消费方会收到 Native scope 解析选出的确切 Provider 的变更，包括子级使用父级 Provider，以及其后代使用更近 Provider 的情况。回调只传记录 key，不传机密 payload。异步消费方工作独立于写入完成；Provider 和 owner teardown 会排空已开始的回调。authorization 的取消与 key 排空语义仍按[原生授权尝试排空后才释放键](../architecture/2026-10-09-native-authorization-drain.zh.md)执行。Cordis 事件行为保持独立。
