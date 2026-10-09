# Agent Note: 原生授权尝试排空后才释放键

Status: implemented

[English](2026-10-09-native-authorization-drain.md) | 中文

## 问题

Cordis 授权服务会立即结算被撤销的尝试，并让 flow 的运行自行结束。原生 Host 需要确定性地卸载 Provider；遗弃运行的迟到凭据写入可能在其所有者释放之后，或在同一键的下一次尝试开始之后才落盘。

## 决策

`@deepseek-ai/dsh-authorization/native` 在不依赖 Cordis 的情况下提供 `authorization` 服务。界面用 `begin()` 开始尝试，从 `frames()` 读取可重放的 `AuthorizationFrame`，并通过 `answer()`、`decline()` 与 `cancel()` 作答。每条取消路径都会中止 flow 的 signal，并且只在 `run()` 返回后才结算尝试。原生凭据记录写入接受该 signal，并在入队开始写入前检查；一旦 mutate 开始就一定提交，因此尚未开始的写入会被拒绝，已经开始的写入会在键释放前完成。

Cordis 服务保留现有的遗弃运行语义；两个入口共享 flow、session、帧与错误类型。

## 考虑过的替代方案

**沿用 Cordis 服务的撤销语义。** 已否决：键释放后仍可能与尚在运行的 flow 及其写入竞争。

**由各 Host 传输自行维护 prompt 状态。** 已否决：每个界面都会重复相同的 prompt id、重放与取消规则。

## 后果

忽略 signal 的 flow 会让 `cancel()` 一直挂起；原生 flow 必须响应 signal。界面在 `settled` 或 `credentials/record-updated` 之后刷新模型目录；不另设目录事件。
