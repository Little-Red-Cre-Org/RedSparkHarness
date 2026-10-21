# Agent Note: Native DeepSeek 请求贡献的所有权

Status: implemented

[English](2026-10-13-native-deepseek-request-contributions.md) | 中文

## 问题

Cordis 请求贡献方依据 Loader fiber 与 Cordis 服务确定所有权。Native 配置则选择包入口、作用域和活动 Session 所有者；复用 Loader 行或根据插件名称推断包身份会丢失这些确切身份。

## 决策

包安装的 Native 插件会将所选 manifest 中实际的非空 `name` 与 `version` 作为 `NativePackageProvenance` 携带，并绑定到确切的安装 id 和作用域。`NativePluginInventory.packages(scope)` 只返回在该作用域及其祖先中可见的就绪包安装；内存安装没有包来源信息。

请求字段注册表有独立的 Native Host 入口。`register(scope, field, provider)` 会将贡献绑定到 Native 作用域可见性，`prepare(scope, request)` 则为每个字段选择最近的可见提供方。`llm-deepseek` 将 `deepseekLlmApiExtensions` 与 `activeSessions` 都视为可选服务：确切 `sessionId` 匹配时使用活动 Agent 的作用域；服务缺失或没有匹配项时使用模型安装作用域。包清单贡献方要求注册表、`pluginInventory` 与 `activeSessions`；会话日志贡献方要求注册表与 `activeSessions`。没有匹配 Session 的请求不会添加会话日志字段。

Native 会话日志交付通过确切活动 Session 所有者读取和追加，并在规范 Session 事件映射中记录接受事实。Native 包清单在匹配 Session 时读取其所有者 Agent 作用域；无匹配 Session 时从贡献插件自身的安装作用域读取。定向 profile 组合会复制 Native headless fixture 用于测试，不会更改随附 profile 模板。现有 Cordis 入口继续使用各自的 Loader 与 Session 服务。Native 入口是显式 Host 包子路径；随附 profile 继续组合 Cordis 入口。Cordis 请求字段决策仍由[既有请求扩展记录](2026-08-21-deepseek-llm-api-request-extensions.zh.md)负责，包目录归属见[官方模型所有权记录](2026-10-06-official-model-integration-ownership.zh.md)。

## 考虑过的替代方案

**从 Native 插件名称或 Cordis Loader 行推导包版本。** 已否决，因为入口名称不是所选 npm manifest 身份，且 Native 安装不要求 Cordis Loader。

**要求每个 DeepSeek 模型都安装 Native 请求服务。** 已否决，因为没有贡献方或活动 Session 所有者的独立 Native 模型仍应有效。

## 影响

包元数据标识所选安装，而非任意运行时回调。提供方作用域查找保留最近作用域的所有权，可选模型能力让无关 Native 组合保持独立。Cordis 与 Native 贡献共用 DeepSeek wire 字段和 Session 事件权威，但各自保留生命周期服务，且不会改变随附默认组合。
