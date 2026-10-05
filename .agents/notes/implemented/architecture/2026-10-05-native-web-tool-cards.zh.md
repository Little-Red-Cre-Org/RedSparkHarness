# Agent Note：原生 Tool 卡片共享持久化呈现与纯 Client 叶入口

Status: implemented

[English](2026-10-05-native-web-tool-cards.md) | 中文

## 问题

原生会话需要可读的 Tool 进度、错误以及冷恢复后的结果卡片。既有卡片模型读取已持久化的结果元数据，但公开类型导入会到达兼容 Conversation 与 Chat 声明。仅供浏览器构建的输入也缺少独立安装 ESM 消费者需要的依赖。

## 决策

Tool 记录类型由一个纯 Conversation 导出统一维护。兼容重导出保留所有消费者。原生 Tool 呈现器复用 GenericToolCard、ToolRow、模型、原子组件和类型化字典；缺失可选操作时不呈现按钮。原生会话根据 Session 事件配对已接受的根调用及结果，不建立第二套执行注册表或写入者。原始记录保留嵌套分派事实。

混合 Client 包在动态兼容入口旁发布显式纯子路径。静态叶构建保留裸导入并输出真实样式资源，不把整个包分类为静态链接。原生策略追踪完整源码和公开声明依赖图，允许真实存在的 Client 样式及已解析、已声明的 DefinitelyTyped 类型提供者；缺失资源、Host 样式导入和 Cordis 引用仍无效。生产声明与浏览器导入均有显式依赖，React 实例保持共享 peer。

`./controller` ESM 子路径单独导出 `NativeConversationController`，不加载 React 页面安装器。Host 测试引用此纯源码叶文件的仅声明项目；Host 聚合配置不引用安装器依赖 React UI 和 `ui-tool` 的 Client application 项目。Client 聚合配置仍完整构建该应用及其消费者依赖图。

## 考虑过的替代方案

另写一套卡片会重复元数据解析和界面行为。导入兼容 Client 入口会保留 Cordis 声明依赖。把整个包转成静态装配会改变兼容组合。无操作的文件或检查回调会显示不可用功能。仅呈现根卡片使本批范围保持精简，同时不丢弃原始嵌套事实。

## 影响

显式原生 Web 呈现器及未来 Desktop 装配共享 Tool 呈现，不改变产品默认装配。既有浏览器场景记录真实文件读取、审批拒绝和冷恢复卡片；定向依赖用例拒绝缺失样式和 Host 样式导入。嵌套调用层级及更多 Tool 专用呈现器保持为独立产品工作。
