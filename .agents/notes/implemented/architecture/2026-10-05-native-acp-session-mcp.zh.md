# Agent Note：原生 ACP Session 的 MCP 所有权

Status: implemented

[English](2026-10-05-native-acp-session-mcp.md) | 中文

## 问题

ACP 控制端提供 Session 专属的 stdio 和 HTTP 服务。将其工具安装到共享 Program 作用域，会把工具暴露给无关 Session，并妨碍独立服务命名空间。

## 决策

MCP Module 拥有两种承载共用、不依赖 Cordis 的 ACP 声明转换器。转换器保留名称规范化与环境／请求头校验；每种承载显式解析既有传输配置和超时。

每个原生 ACP Session 拥有独立下级作用域和资源所有者。选定的执行器继承该作用域，由维护中的 MCP 连接监督器在此注册工具并拥有传输代际。安装前校验完整列表。初次发现先于持久化创建和发布；安装失败排空其连接与注册，不创建 Session。恢复先核对存储所有权，再挂载提供的声明。

Session 关闭或 Program EOF 会停止准入，并取消选定执行器与连接。MCP 撤销在取消期间开始；资源释放等待协作排空。清理失败会保留正在关闭的记录，拒绝恢复、提示和配置修改。仅清理成功才移除记录；EOF 聚合上报失败。MCP 诊断使用承载选择的 stderr logger。执行器仍是唯一 Session writer，记录每项模型可见工具 schema 与结果。

## 考虑过的替代方案

第二套 RPC 客户端会重复维护中的 MCP 传输监督器。共享 Program 注册会暴露外部工具，让同名服务冲突。发布后才连接，会在必需工具尚不可用时报告 Session 可用。

## 影响

显式原生 ACP profile 安装既有工具 Provider。同级 Session 可复用服务名，并独立释放连接。兼容默认值和历史 Session 代际不变。不增加 MCP 资源、提示词或不支持的传输类型。
