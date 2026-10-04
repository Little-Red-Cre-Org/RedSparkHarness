# Agent Note：共享原生 storage 与 domain 适配器

Status: implemented

[English](2026-10-04-native-storage-domain-adapters.md) | 中文

## Problem

原生 workspace 归档需要现有 domain 全局记录。第二 settings namespace、JSON sidecar 或复制的 domain 实现会分裂持久化权威。共享后端及 domain 运行时依赖 Cordis context 分发，尽管其介质与写入排序独立于框架。

## Decision

storage 通过原生服务及纯后端词汇叶入口发布同一个命名后端注册表。选定后端 Provider 在完成注册后发布绑定该精确注册表的通用就绪状态。domain Provider 要求就绪状态，拒绝其他注册表，并在接纳 Consumer 前解析全部配置后端引用。替换后端不需要让 domain Consumer 依赖 JSON 专属服务；多个后端需要显式组合就绪发布者。

JSON 兼容和原生适配器导出同一后端类，保留现有 layout、原子发布、配置根目录及版本标记。共享 domain facility 使用相同 spec 校验、unit 句柄、权威 map 及单一写链。框架适配器提供窄接口的持久化变更分发器及诊断报告器。纯事件载荷只有一份声明；兼容事件 augmentation 独立。

关闭停止接纳，并拥有每个已接纳打开，直到其登记 domain 或释放 unit。domain 和 JSON 后端在报告错误前尝试全部已接纳清理。失败打开同时保留原始错误及 unit 清理错误；facility 释放也报告这些实际 unit 清理错误，不将加载失败归为清理失败。后端持久确认仍是提交点：内存变化及通知在其后发生，同步观察者失败不能回滚已写值。

兼容目录在提取共享实现后仍保留继承的公共 Facility 方法。

后端词汇是仅面向 Host 的公共源码出口；原生依赖检查扫描其真实 Host 源码，拒绝 Cordis 引用，并仍拒绝缺失的已发布源码。

## Consequences

Core 原生源码及公共声明不导入 Engine 或 Cordis 执行权威。不引入新路径、归档 schema、文件系统删除操作或第二仓库。原生 workspace 是这些服务的后续 Consumer，并保留其唯一现有 v2 全局归档记录；基础设施证明不能确立产品归档 UI 或完整 P4/P5 完成。

原生诊断使用 Host console；兼容适配器保留 context logger。已接纳文件系统工作在取消时排空，不被遗弃。已停止 facility 不能再次打开。兼容入口仍是显式适配器，原生激活不会静默挂载它们。

## Alternatives considered

JSON 专属就绪要求会把 domain Consumer 耦合到一个可替换 Provider。依赖偶然行顺序等待后端注册会造成 Consumer 激活竞态。复制 JSON 或 domain 状态机会产生竞争的发布及恢复语义。私有归档仓库会与 workspace 现有全局记录冲突。只关闭已登记 domain 会泄漏在卸载期间完成已接纳加载的 unit。

## Verification

兼容后端、注册表和 domain 测试保留 69 个现有通过用例。原生 Host 测试验证 JSON 持久写序及冷打开字节不变、未知路由激活拒绝、已接纳加载关闭排空及失败 unit 清理同时向调用者和 Host 停止报告、提交后观察者失败隔离、替换后端就绪及其他注册表拒绝。owner 编译、源码 lint 及公共 JSDoc 检查通过。已安装产品组合及 workspace 归档 Consumer 仍属于独立验证义务。
