# Agent Note: Desktop 启动错误脱敏

Status: implemented

[English](2026-10-16-desktop-startup-error-redaction.md) | 中文

## 问题

Schema 校验消息可能包含配置值。发给 renderer 的启动错误不能暴露这些消息、嵌套 cause 或用户命名的字典键。

## 决定

pi-ai 原生配置生产者保留原 Schemastery 校验错误及其 message 供本地诊断，并在存在安全路径时附加第一条 schema issue，路径中的字典键替换为其在输入中的序号。

Desktop 与 DesktopHost 沿错误 cause 或 AggregateError 链查找首个结构化 issue，只投影字符串或数字路径段及字符串 rule，不读取 message。错误类型来自固定的 Error.name 集合；其他名称映射为 `Error`。

## 考虑过的替代方案

**在每个 Desktop 包维护配置字段白名单。** 不采用，因为 schema 由 pi-ai 拥有，安全路径应由它直接生成。

**只显示通用错误。** 不采用，因为安全字段路径能帮助用户定位无效配置项。

## 影响

renderer 状态只含本地化错误类型及可选路径和 rule。Host 诊断与 stderr 写入本地 Desktop 主进程日志。

## 验证

启动回归用例通过 `pi-ai` 原生解析触发真实 Authorization 数组 schema 错误，并检查序号路径及 fake token 不出现在错误消息、stack、cause 和 renderer payload JSON 中。现有 adapter 与 native-module-management 用例继续检查 cause 链脱敏。
