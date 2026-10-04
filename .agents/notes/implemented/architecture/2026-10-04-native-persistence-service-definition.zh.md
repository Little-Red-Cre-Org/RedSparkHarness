# Agent Note：与 Provider 无关的原生 Session 持久化

Status: implemented

[English](2026-10-04-native-persistence-service-definition.md) | 中文

## Problem

原生 sessionPersistence 服务类型归 JSONL 具体后端所有。替换 Provider 和已支持的原生 Headless 应用因此依赖该 Provider，尽管其操作已共用规范句柄 API。

## Decision

Persistence 拥有 NativeSessionPersistenceOperations 和其 NativeServices 声明。create、open、flush、stat、list 签名保留现有可观察义务。兼容 Service 实现该接口。JSONL 通过该 Definition 发布现有后端，并保留释放所有权；Headless 使用同一 Definition，只拥有其选定 Session 句柄。Consumer 不获得服务级 close 所有权。

显式 @inheritdoc 服务方法使用已实现接口的完整文档，并保留原有签名。目录检查仍拒绝不完整的所有者声明文档。SDK、SessionExecution 及下游领域 Consumer 属于独立批次。

## Consequences

替换 Provider 可发布同一原生服务键而不导入 JSONL。句柄新鲜度、取消、格式拒绝及单 writer 规则不变。JSONL 路径、配置、恢复及代际不变。Native runtime 是 Definition 的普通依赖；Cordis 仍是可选兼容 peer。不增加删除 journal 或 Client 编译面。

## Alternatives considered

JSONL 类型引用会保留意外的 Provider 耦合。局部接口会遗漏执行操作。重复方法文档会分离可观察义务；暴露服务 close 会将 Provider 所有权转交 Consumer。

## 验证

现有 JSONL Host 用例覆盖 manifest 一致、持久写入及冷恢复。现有 Headless 用例覆盖模型与工具日志、恢复及已接纳 stream 关闭排空。继承文档用例覆盖完整接口、缺失文档及泛型签名。已安装产物的 Cordis-deny 消费仍须单独验证。
