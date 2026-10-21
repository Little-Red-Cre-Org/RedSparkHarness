# Agent Note: 原生 Shell 实时输出

Status: implemented

[English](2026-10-05-native-shell-live-output.md) | 中文

## Problem

原生 Shell 后台输出在结束前不可用。

## Decision

原生 Bash 和 PowerShell 后台消费者将捕获的 stdout、stderr 发布到选定的 NativeJobs 注册表。现有子进程输出收集监听器传递字节而不消耗保留输出；共享本地 Shell 控制器分别解码每个流的 UTF-8。输出回调属于可信进程内输入，不得抛出异常。

NativeJobs 拥有可配置的有界尾部输出，并在取消或结束时停止接受发布。Shell 消费者用既有最终渲染结果替换尾部，保留丢失、溢出恢复、沙箱运行失败和拒绝事实。不引入并行输出注册表或轮询循环。托管子进程取消完成后后台句柄才结束；清理观察失败使句柄拒绝。

## Consequences

验证覆盖真实运行输出及随后的取消，以及发布的 dsh PTC profile 中记录的 job_output 结果和冷读 Session。远端 E2B 观察使用既有帧分发器；远端运行验证需要供应方凭证。

## Alternatives considered

轮询消耗保留输出或增加第二个所有者。直接观察捕获事件保留既有输出与 Session 所有权。
