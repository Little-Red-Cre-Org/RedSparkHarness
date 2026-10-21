# Agent Note: Native Models settings uses shared provider editors

Status: implemented

[English](2026-10-11-native-models-settings-page.md) | 中文

## Problem

Cordis Models 页面和 native Settings 窗口都需要相同的 API 提供方表单；native-application 不能导入 Cordis 功能包，也不能复制其 CSS，否则相同的呈现会有两个所有者。

## Decision

`ui-primitives` 拥有仅通过 props 驱动的提供方卡片、模型编辑器、页脚和样式表。Legacy Models 插件与 native 应用分别向这些组件提供自己的设置操作、schema 操作和本地化文案。

Native Models 页面合并 `modelsListProviders`、`modelsListConfigurableProviders`、已脱敏的 Settings 描述和凭据描述。它通过带 revision 的 `settingsMutate` 写入提供方修改，通过凭据操作保存 API 密钥，通过 `modelsDiscover` 执行发现，并在 Settings、凭据引用和适配器事件到达时重新读取。「订阅模型」区域为每个 Host 条目呈现一个授权行，并将匹配的账户卡片放在该行内；没有匹配流程的账户摘要仍显示在该区域。切回 Models 时会重新读取授权条目，以恢复进行中的登录。共享的 [SettingsPanel](2026-10-11-shared-settings-panel.zh.md) 继续拥有窗口外框。

## Alternatives considered

**仅按业务帧空闲时间设置超时。** 授权订阅不采用此方案，因为健康的流程可能在等待用户输入时不产生业务帧。Host 发送仅用于传输的 SSE 注释心跳；Client 对静默传输设置超时，包括等待响应头的阶段。订阅丢失会刷新 Host 状态，每个尝试允许自动重订阅一次，此后需要手动刷新。订阅丢失不会取消 Host 上的授权尝试。终态帧结束观察，已被替换的订阅不能再应用迟到帧。

**导入 legacy Models 功能包。** 拒绝，因为其数据层和页面集成依赖 Cordis 与 legacy slots，native-application 无法导入。

**将编辑器组件和样式表复制到 native-application。** 拒绝，因为两个页面会分别拥有同一份提供方呈现。

**只使用通用的 native JSON 设置编辑器。** 拒绝，因为它不提供精选的模型列表编辑器或端点发现控件。

## Consequences

两个页面共用一套提供方编辑器实现，同时保持各自的数据所有权独立。Native 应用需要将 Host 操作和已发布 schema 适配为编辑器回调，并由每个页面提供完整的本地化文案。端点发现会为当前请求接收输入的 API 密钥；发现操作不会保存该密钥。
