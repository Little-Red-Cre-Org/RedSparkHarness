# Agent Note: 包分组表完整性检查

Status: implemented

[English](2026-09-13-package-group-table-check.md) | 中文

## Problem

包分组可以存在于磁盘上，却未出现在中英文包概览中。链接校验无法发现缺失的链接。

## Decision

包分组检查对照目录名称与两份概览表，拒绝遗漏、失效、重复和空清单，并纳入完整及快速文档检查。MCP 分组在两份概览表中均有对应条目。[子系统归属检查](2026-08-03-package-anchored-subsystem-pages.zh.md)保持独立：它负责指定文档归属，而不是检查概览覆盖范围。

## Alternatives considered

**依赖链接校验：** 已有链接可能全部有效，但概览仍缺少整个分组。

**仅检查一种语言：** 一份概览可能遗漏分组，而另一份仍然完整。

## Consequences

增删分组需要同步更新概览。解析与比较测试覆盖无效清单，检查图测试确认完整文档流程的接入。本检查验证分组成员关系，不验证职责描述是否准确。
