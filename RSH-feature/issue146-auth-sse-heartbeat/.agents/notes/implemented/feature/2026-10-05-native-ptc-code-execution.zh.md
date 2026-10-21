# Agent Note: 原生 PTC 代码执行

Status: implemented

[English](2026-10-05-native-ptc-code-execution.md) | 中文

## 问题

原生程序化工具调用需要真实 JSON 值业务工具、有序持久调度和遵守所选文件策略的执行能力。单独的 worker 既不提供模型工具，也不提供操作系统约束。

## 决策

代码工具通过 NativeTools 注册 `run_code`，并用其有序 PTC dispatcher 调用可见值工具。Jobs 控制保留模型文本，同时向程序提供可序列化值。Prompt 呈现接受请求 Agent 的 scope，使 SDK 声明和可执行 binding 选择同一组工具。Headless 将内置工具与注册表贡献分开显式选择；可选 PTC 组合只使用注册表路径。

受限执行采用真实 subprocess Provider 和共享本机沙箱 backend。私有子进程将执行交给既有 worker 实现。原生和 Cordis 沙箱安装器共用执行器选择、文件策略构造和临时授权清理。两个安装器都不会扩大平台 backend 已说明的执行强度。

工具目录选择各包的 Cordis 或原生安装协议。原生 schema 采集使用真实工具 Consumer 及其选定 Provider，采集结束后关闭 Host，并保留对遗漏包和空注册的拒绝。

## 后果

父应用仍是唯一 Session writer。嵌套调度记录和外层结果使用既有事件 payload。完成、失败和取消都会在外层调用结束前排空已准入调度。受限运行时绝不脱离沙箱重试。明确允许不受限执行的组合仍可选择 worker。

此可选组合不改变应用默认值。Python 需要另行选择 Provider；本批提供 TypeScript 进程 Provider。文件约束不等于网络隔离，Windows ACL 的部分执行仍是部分执行。

## 考虑过的替代方案

解析呈现文本会捏造程序值。另一份沙箱实现会分裂执行器和授权的所有权。第二份 worker loop 会复制执行行为。根据服务是否存在选择注册表工具，会隐式改变既有 profile。

## 验证

发布检查覆盖构建后的原生入口和公开 NodeNext 声明。局部产品检查启动真实 `dsh` profile，通过 `run_code` 查询和取消真实 Agent-owned job，并检查持久 PTC 事实。受限进程检查通过真实本机 backend 执行程序并拒绝文件写入。宽松沙箱或 echo 工具均不提供这些能力。

运行时在停止程序时通知调用方取消绑定，再等待已接受回复；停止通知不会把原超时或异常改成取消结果。Worker 在底层终止和管道排空后才退出 live 集合。
