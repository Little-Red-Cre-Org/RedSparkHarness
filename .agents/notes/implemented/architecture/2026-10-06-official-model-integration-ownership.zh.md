# Agent Note：官方模型集成的所有权

状态：已实现

[English](2026-10-06-official-model-integration-ownership.md) | 中文

## 问题

提供方无关的 `dsh-llm` 服务与提供方专用适配器位于同一个 Engine 包组。物理目录容易让人认为上游协议和提供方请求元数据属于 agent 执行，尽管这些适配器实现的是官方集成。`dsh-session-log-deepseek` 会读取规范 Session 服务以添加请求元数据并记录交付接受状态，但它不负责 Session 存储、格式或查询行为。

## 决策

`dsh-llm`、`dsh-native-model-selection`、`dsh-llm-retry` 与 `dsh-token-meter` 留在 Engine LLM 组。`dsh-llm-deepseek`、`dsh-llm-pi-ai`、`dsh-deepseek-llm-api-extensions`、`dsh-plugin-package-inventory-deepseek` 与 `dsh-session-log-deepseek` 归入 `Modules/Official/llm`。包名、公共导出与运行时组合保持不变。两个提供方适配器已有 Cordis 与 Native 两种入口；三个请求贡献包仍只有 Cordis 入口，本次所有权迁移不会改变其入口支持情况。Session 包仍拥有事件映射根类型、持久化 API 与格式目录；提供方贡献会扩展事件映射，但不接管这些职责。

## 考虑过的替代方案

**所有 LLM 相关包继续留在 Engine。** 这会让官方提供方协议与提供方无关的执行代码混在一起，也会模糊请求贡献的所有权。

**让 `dsh-session-log-deepseek` 留在 Session 存储组。** 该包只发送一个提供方专用请求字段及其交付事件；它不提供存储或查询，并依赖官方 DeepSeek 请求扩展注册表。

**按新目录重命名公共包。** 目录所有权可以调整，无需破坏包名导入或已发布入口。

## 影响

新的官方提供方适配器及其专用请求贡献应位于 `rsh/Modules/Official/llm`。提供方无关的路由、模型选择、重试、token 计量与 Session 存储仍归各自 Engine 包组负责。三个仅有 Cordis 入口的贡献包仍需依照 P4 能力计划单独确定 Native 支持方案。工作区引用、生成的包映射与文档需要记录新的物理位置，消费者继续使用现有包名。
