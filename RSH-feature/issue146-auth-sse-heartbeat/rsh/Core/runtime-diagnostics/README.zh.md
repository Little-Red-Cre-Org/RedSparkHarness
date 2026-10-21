---
description: "runtime-diagnostics 组地图：针对运行中组合的包自有运行时不变式检查，供浏览本组的用户与维护者参考。"
kind: "package-group"
---

# rsh/Core/runtime-diagnostics

[English](README.md) | 中文

## 概述

runtime-diagnostics 组为 DeepSeek Harness 组合提供运行时自检与插件所有权支持：`invariants` 在组合运行期间运行包自有检查，验证持久化事件与数据关系；`compat-plugin-host` 记录 RSH 角色元数据，同时将旧式插件生命周期交给 Cordis。违规会以归因到拥有该关系的包的错误呈现；全局开关与包名过滤器控制运行哪些 invariant 检查。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`invariants`](invariants/README.zh.md) | 运行包自有运行时检查，并按所属包报告每次失败 | 注册到 `ctx.invariants` |
| [`compat-plugin-host`](../../Compatibility/DSH/bridge/compat-plugin-host/README.zh.md) | 记录 RSH 插件角色并适配旧式 Cordis 插件生命周期 | 注册到 `ctx.pluginHost` |
| [`native-runtime`](native-runtime/README.zh.md) | 解析并激活原生插件计划，提供作用域服务和所属资源清理 | 无 Cordis context |

-----

<a id="related-documentation"></a>
## 相关文档

- [运行时不变式子系统](../../Docs/subsystems/invariants.zh.md)——生成的服务参考：选择、installer 与配套入口约定。
- [不变式运行时约定 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-19-package-invariant-runtime-contracts.zh.md)——运行时不变式可以断言什么，以及强制配套入口接线的机械门禁。
- [包约定](../../../AGENTS.md)——每个包都必须遵循的 `./invariant` 配套入口规则。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
