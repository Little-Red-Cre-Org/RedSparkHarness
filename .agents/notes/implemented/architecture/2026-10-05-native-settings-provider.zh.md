# Agent Note：原生文件设置

Status: implemented

[English](2026-10-05-native-settings-provider.md) | 中文

## 问题

原生 profile 选择了 `settings-file`，但该包没有原生安装入口。只有移除该行才能启动，`settings.yaml` 中的模型路由变更也无法进入原生执行。

## 决策

`dsh-settings/native` 定义不导入 Cordis 的 namespace 所有权、分层解析、有序 revision 写入和实时读取。原生 `settings-file` Provider 使用现有的 home 路径、YAML/JSON 文档、跨进程文件锁和原子替换；它保留未注册分节，并通过同一服务应用有效的外部编辑。原生 pi-ai Consumer 注册 `llm-pi-ai`，用存储的用户分节覆盖 profile 基础配置，并在下一次请求使用已提交的路由表。凭据值仍由现有原生凭据 Provider 保存；设置只保存引用。

## 结果

非法文档阻止启动或服务写入；运行中外部编辑非法时保留最后有效的模型配置，并报告重载失败，不记录文档内容。原生设置公开 owner scope，而非旧版 schema 描述与脱敏 API，因此不隐含通用远端编辑器。没有设置 Provider 的原生 Host 保持组合配置中的 pi-ai 路由。

## 考虑过的替代方案

在原生 Host 内运行 Cordis 设置服务会产生第二个生命周期权威。复制完整的兼容管理 API 会在原生 Client 尚无明确所有者前扩大公开原生接口。

## 验证

两项定向原生 Host 检查覆盖文档保留、revision 冲突和从设置加载模型路由。Host 类型检查、原生依赖门禁、包构建与已构建入口导入验证包路径。完整已发布 profile 启动仍依赖单独的 `agent-instructions` 原生安装入口。
