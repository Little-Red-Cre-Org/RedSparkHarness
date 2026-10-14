# Agent Note: Native staged file attachments

Status: implemented

English | [中文](2026-10-14-native-staged-file-attachments.md)

## 问题

Native Web 与 SDK 调用方需要在模型轮次开始前上传文件字节，并将文件放入有序的初始、排队和 steer 消息。所选 immutable attachment Provider 已拥有文件字节和 `FileAttachmentRef`；客户端提供的引用不能替代该 Provider，也不能绕过 durable Session message。

## 决策

所选 Program 的 `rootExecution.stagedFiles` 通过现有 attachment Provider 暂存流，并返回绑定 root route、Session id 和已捕获 Session generation 的进程内 receipt。generation 在异步存储读取前捕获，并在每次读取完成后及发布 receipt 前重新检查。成功删除、恢复 Session 或替换 fork 目标都会使 receipt 失效；idle owner detach 不会。

Native Web 通过经过认证的流式 Fetch 请求传输文件字节。Web、TypeScript SDK 和 Python SDK 输入使用有序的 text、image 和 staged-file 部分。精确匹配的 attached root owner 会在 user message 中将 receipt 替换为现有 durable FileBlock；此实现不增加 Session event 或 format version。

准备失败或在 `owner.enqueue` 收到消息前得到可证明的拒绝时，会释放 reservation。enqueue 成功或观察到精确 durable inbox event 时，消息被接纳并 retire 对应 receipt。handoff 后若发生拒绝且未观察到接纳，结果属于不确定状态：receipt 会被隔离，并返回要求重新上传的明确错误。后续 wake 或 cleanup 失败不能撤销 durable acceptance。

Headless 使用所选 Provider 的文件路径，并由所选 filesystem 转换为 execution-world 路径，将已记录的文件引用投影到模型输入。Root 和 captured-external 内建 `read_file` Consumer，以及 Native `tool-fs` `read`，仅对当前 Session 派生消息中仍存在的引用开放流式读取，并要求请求路径与投影路径解析到相同 filesystem target。workspace 外的其他路径和所有写入仍遵循现有 filesystem policy。

## 考虑过的替代方案

**增加 receipt vault 或第二个 Session writer。** 不采用，因为所选 root executor 已拥有 route、Session generation 与 inbox admission，而 attachment Provider 已拥有 immutable bytes 及其清理职责。

**上传只使用 base64 JSON。** 不采用，因为经过认证的 Fetch carrier 可以将请求体直接流式传入 `stageStream`，不必再聚合一份编码副本。

**开放 attachment storage 目录读取。** 不采用，因为目录权限会包含无关文件；当前 FileBlock 引用和解析后的 filesystem target identity 已能提供所需读取权限。

## 后果

Receipt 仅存在于进程内，Program 关闭时会清除，进程重启后需要重新上传。Receipt 结算和 Program 关闭都不会删除共享 immutable bytes；存储和垃圾回收仍由现有 attachment Provider 负责。调用方不得使用同一 receipt 重试不确定的 handoff。

## 测试

Native Headless lifecycle 回归测试覆盖 idle detach 后 receipt 仍保留，并在 delete 与 same-header restore 发生于 initial stat、attachment save、final stat 三个受控窗口时验证 Session generation 竞争。文件读取回归测试覆盖 root `tool-fs` 和 captured-external `read_file`，验证完整流式文本，并拒绝无关 workspace 外部读写。
