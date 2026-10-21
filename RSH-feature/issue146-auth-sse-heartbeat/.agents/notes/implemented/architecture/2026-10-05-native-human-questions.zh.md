# Agent Note: 原生人类问答与待回答问题 broker

Status: implemented

[English](2026-10-05-native-human-questions.md) | 中文

## 问题

原生工具需要既有人类问题词汇与仅限根调用的权限，并且不能加载 Cordis。profile loader 每包选择一个原生 installer，因此问题 Definition 与可独立选择的待回答问题 Provider 不能共用单个 manifest 入口。

## 决策

`user-questions/protocol` 拥有未改变的问题与回答值。兼容事件声明与 `UserQuestionService` 转发这些值；共享错误继承规范 errors 包。原生注册表验证准确注册的 Agent 与 writer 可用的活动 Session。当前委托调用会被拒绝；历史子级谱系不会阻止恢复为根的调用提问。

注册表通过 awaited waterfall 选择 scoped 回答者。委托保留上游取消信号。移除回答者、释放 Agent 或停止 Host 时取消并排空已接受的工作，包括下游呈现。broker 保留原 Agent 与随机 branded 请求身份，校验提交 JSON，并拒绝身份不符、重复或过期回答。移除最后一个订阅接收者会取消其待处理呈现。

独立 `user-question-broker` 包为原生 profile 发布同一 broker installer。它没有第二个注册表、锁或请求 map。工具 Consumer 注册规范值工具，保留紧凑 JSON 回答，并通过 Program 既有的唯一 writer 记录普通错误。不增加 Session 事件或改变已有代际。

## 考虑过的替代方案

第二份 broker 实现会分裂待处理工作的所有权。为了一个局部 Provider 需求修改 CLI loader 以选择任意次级入口，会扩大应用安装语义。复用既有实现的独立 Provider manifest 提供所需选择能力。

## 影响

一条 NativeHost/Headless 用例通过 JSONL 存储覆盖接受回答、无效选项、后续模型请求、持久结果记录、委托回答者移除与过期回答拒绝。一条无密钥 Session 快照通过构建后的 `dsh` CLI 启动发布的 `native-headless` 模板，使用独立的仅问答装配与脚本 broker 接收者，保留问题 schema、呈现的回答和后续模型上下文。两者使用受控模型，不是产品模型 Provider。此能力组不提供 SDK、ACP、终端或 Web 回答传输；这些消费者属于后续独立发布工作。公开 profile resolver 与构建入口检查独立验证 installer 选择，与受控模型用例分别提供证据。
