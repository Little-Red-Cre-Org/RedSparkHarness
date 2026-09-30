# Agent Note：Cordis-free Client UI 基础包

Status: implemented

English | [中文](2026-09-24-cordis-free-client-ui-foundations.md)

## 问题

Client slot 约定只为让 renderer 观察作用域所有者的销毁而暴露了 Cordis `Context`。共享状态存储的 Zustand 和 Immer 运行时导入也被错误声明为开发依赖，导致 manifest 与发布内容不符。

## 决策

`ScopedStandardSourceBinding` 使用 `SlotScopeLifetime` 标识一个作用域代际并接收清理操作，不再指名运行时框架。现有 Cordis `ui-session` 适配器把 `Context.effect` 转换为该接口。React-free 状态存储包将 Zustand 和 Immer 声明为运行时依赖，并移除 Cordis 依赖。包依赖检查器将这些保留在 ESM 输出中的导入列为 Client 运行时依赖；其他浏览器构建输入仍属于开发依赖。UI slots 包依赖状态存储类型，也不再要求 Cordis。

React renderer、slot registry 服务和已装配的 Client 插件仍使用 Cordis。这些共享 UI 包可供原生运行时复用；它们的拆分不代表生产 Client 已迁移。

## 考虑过的替代方案

**继续在每个作用域绑定中暴露 Cordis `Context`：** renderer 只需要作用域身份和销毁通知，因此这种做法会让原生 Client 所有者继续依赖 Cordis，并暴露无关的运行时 API。

## 影响

原生 Client 作用域所有者可以通过运行时资源所有者提供清理能力，而无需导入 Cordis 类型。现有 Cordis Session 仍会在作用域结束时清理 slot store。原生依赖检查会覆盖这两个共享包及其声明。包依赖检查要求 Client 运行时依赖清单与源码导入一致。

## 验证

Client 作用域绑定和 store 生命周期测试验证 Cordis 适配器清理。原生依赖检查会拒绝这两个包的 Cordis 源码及包依赖边。包依赖检查会验证已审查的 Client 运行时导入清单，打包消费者测试会解析声明的库。包构建和双语文档门禁会验证导出类型与依赖声明。
