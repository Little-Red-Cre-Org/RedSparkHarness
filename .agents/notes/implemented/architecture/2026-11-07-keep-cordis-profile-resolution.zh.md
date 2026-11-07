# Agent Note: Cordis profiles still resolve

Status: implemented

[English](2026-11-07-keep-cordis-profile-resolution.md) | 中文

## Problem

`resolveRshProfileDirectoryExecution` 拒绝了 `bundles` 列表和显式的 `runtime: 'legacy'`。对一个不再提供 Cordis 的版本，这能让过期的 Cordis profile 直接失败。这个版本仍在提供 Cordis。`legacy-sdk` 是封闭快照 profile，Python SDK 冒烟会启动 `dsh --profile legacy-sdk`；两者都带着 bundle 列表。这次拒绝让这些通道变红，却没有拿掉它们所运行的 runtime。

## Decision

带有 `bundles` 数组且没有 runtime 的 manifest，或带有 `runtime: 'legacy'` 且没有 native 配置字段的 manifest，解析为 `{ runtime: 'legacy', reload: 'startup' }`。解析器按 profile 目录警告一次，并写明 native 标记。它不改写 manifest。同时声明了 `bundles` 或 `patchReload` 的 native 标记仍然失败。既没有 native 标记也没有 bundle 列表的 manifest 仍然失败。缺失的 manifest 仍是 legacy 且不警告，因为那个答案是「尚未初始化」，不是「Cordis」。

## Alternatives considered

**保持硬拒绝，并把 `legacy-sdk` 改到 Native profile。** 这次不采用。快照 manifest 和 Python 冒烟的目的就是用 Cordis profile 自己的名字运行它。把它们指到 Native 会让变红的 CI 变绿，因为测试不再测试 Cordis，而且改写量大于解析器这一处。

**去掉警告。** 不采用。Cordis 副本还在时，选中它应当看得见，否则下一次删除会再次靠 CI 失败才发现同一批调用方。

## Consequences

Cordis profile 又能启动，每个 profile 在本进程第一次读取时打印一次警告。删掉 Cordis 半边仍然被这些调用方挡住。Native 组合不变：它们仍然不能带 bundle 列表。
