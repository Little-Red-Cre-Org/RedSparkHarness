# Agent Note：共用原生 MCP 传输与工具投影

Status: implemented

[English](2026-10-05-native-mcp-shared-transport.md) | 中文

## 问题

原生工具注册表需要真实 MCP 传输、发现和结果转换。另建桥接会重复重连资源所有权，并可能使原始结果或图片准入与兼容入口不同。

## 决策

[原生 MCP](../../../../rsh/Modules/Official/mcp/mcp-client/src/native.ts) 将选定注册表、作用域、模型及附件接口交给共用连接监督器与工具核心。Cordis 将既有服务交给同一实现。官方 SDK 拥有 stdio 与 Streamable HTTP 协议通信；子进程接口提供凭据清理。注册属于安装实例，每次已接受调用保留自身取消信号。

图片投影通过选定 Model Provider 解析真实 Session 的 provider/model，再通过附件操作保存有序批次。规范 MCP 原始结果仍供程序调用方使用。只有选定 Program 记录已接受结果及模型可见内容。

## 考虑过的替代方案

另建原生协议实现会重复传输清理及 schema 处理。仅内容工具丢失规范值结果。虚构模型能力查询不能授权图片输入。这些方式无法保留既有生产者和消费者关系。

## 后果

两个入口共用命名、schema 接受、重连策略及图片诊断。释放等待连接尝试、同步和工具注册排空，并报告清理失败。取消调用不能接受之后的传输结果或图片投影；已接受的图片准备仍被拥有直至终态。不新增模型循环、Session writer 或结果索引。

## 验证

所属编译器与三个既有用例覆盖规范混合图像值、Streamable HTTP 配置和重连取消。无密钥的 [MCP 图像场景](../../../../snapshots/native-headless/mcp-image-native.snapshot.ts) 用 opt-in profile 启动 `dsh`，连接真实 stdio MCP Server，并由实际 Pi 模型 Provider 请求受控 HTTP。记录和只读重放验证下一次模型请求中的持久附件字节、完整结果顺序、prompt/schema 旁文件和冷日志固定点。此场景不覆盖公开 HTTP MCP Server 或重连恢复。
