# Agent Note: Native 回放缺失的沙箱运行器

Status: implemented

[English](2026-11-11-native-missing-sandbox-runner-replay.md) | 中文

## Problem

missing-sandbox-runner 的录制让 `bash` 在只读隔离下运行 `true`，再让 `job_output` 查询 `bash-1`。保存下来的结果是后端不可用的拒绝，以及 `unknown job`。十二行 Native 测试 profile 没有 shell，也没有沙箱提供者，所以这段录制无法回放。

## Decision

Native 场景安装 subprocess、shell 环境、只读沙箱策略、bash，以及一个快照提供者。这个提供者的 `confine` 在命令前加上 `.dsh-missing-sandbox-runner`，它不是可执行文件。启动失败变成同一条后端不可用错误，也不会发布任务。随后 `job_output` 报告未知任务。

## Alternatives considered

**不安装沙箱提供者。** bash 工具要么拒绝启动，要么不受隔离地运行命令。两种结果都对不上录制。

**在 Windows 上跳过这个场景。** 拒绝发生在命令运行之前，同一段文字已经提到 Windows 运行器。回放不需要 POSIX 主机。

## Consequences

安装了真实沙箱后端的 profile 不变。这个场景的提供者只存在于快照里，并且总是失败关闭。
