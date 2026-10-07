# Agent Note：Settings 定义保持在 Cordis 之外，Cordis 声明位于 Compatibility

Status: implemented

[English](2026-10-07-settings-definition-ownership.md) | 中文

## 问题

Native Settings 提供方与消费方需要共享服务定义，Cordis 插件则需要 `Context.settings` 和事件 augmentation。若两个约定都留在 Cordis 提供方旁边，Native 包就会依赖提供方拥有的 API，Cordis 框架也会进入 Core 声明。

## 决策

`@deepseek-ai/dsh-settings-definition` 拥有框架无关的 Settings 类型、协议类型和 Native Settings 接口，其源码不导入 Cordis 包。`@deepseek-ai/dsh-compat-settings-definition` 拥有 Cordis `Context.settings`、事件 augmentation 和注册选项。Cordis 与 Native 的具体实现仍位于 `dsh-settings`；文件存储仍由 `dsh-settings-file` 负责。

Cordis 消费方只在 Cordis 入口需要这些声明的位置导入兼容包。Native 声明使用 Core 包。`dsh-settings` 根入口保留类型重导出，因此既有提供方消费方仍可从原包入口使用它们。Engine 服务的 profile 专用 Settings 注册由 `dsh-compat-settings-adapters` 持有；各适配器从服务原有的 owner Context 接入，Engine 仅保留类型明确的 source 绑定和组合配置回退。

## 考虑过的替代方案

- **所有声明继续留在 `dsh-settings`**——Native 提供方与消费方仍依赖同时拥有 Cordis 实现的包。
- **把 `Context` augmentation 放进 Core**——Core 源码会依赖 Cordis，无法再作为框架无关的定义包。
- **在每个消费方复制接口**——提供方、remotes 与客户端可能对 namespace、脱敏和编辑类型产生分歧。

## 后果

工作区新增独立的 Core 与 Compatibility 声明包；源码别名、项目引用、依赖策略和类型等价映射明确记录各自所有者。Cordis 包依赖兼容入口；Native 定义使用 Core Native 导出，不会加载 Cordis 声明包。
