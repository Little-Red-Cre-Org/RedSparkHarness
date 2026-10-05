# Agent Note: 原生 Web 对话使用选定 Host executor

Status: implemented

[English](2026-10-05-native-web-conversation.md) | 中文

## 问题

原生 Web 启动与 Session RPC 包尚无对话 Consumer，用户无法从页面创建或恢复 Session。

## 决定

原生 Client 应用消费既有 Session RPC Consumer，只提供对话交互与呈现。它创建或选择持久化 Session，并通过唯一 Host turn executor 提交用户文本。选定 renderer 拥有 React root；应用拥有视图控制器和未完成调用。

取消将视图切为停止中，不宣称就绪。发送操作在 Host writer 清理及持久化历史刷新期间保持未完成。应用释放会中止自有调用并等待其结算；移除 React 不提前释放执行所有权。

## 转录与装配

用户转录行使用 append-origin Session 事件和共享消息投影。仅用于模型的替换不能擦除用户已经看过的对话。原始持久化记录保留最小页面尚未提供功能卡片或交互决策的工具与权限事实。

首次使用的原生 Client roster 只包含已有安装器的 Provider 和 Consumer。页面拥有完整的类型化英中文字典对，并接受显式 locale 配置。它不创建 Settings 权威，也不切换旧默认装配。

## 考虑过的替代方案

**轮询历史或状态。** 轮询无法证明流式执行进度，并添加独立调度生命周期；结算刷新读取持久化记录；实时发送由[跟随决策](2026-10-05-native-web-session-follow.zh.md)定义。

## 后果

页面在结算后刷新持久化转录。[实时跟随](2026-10-05-native-web-session-follow.zh.md)复用同一准入与结算权威；轮询历史或状态会把推测误当成执行流。支持的交互限制归 [包参考](../../../../rsh/Programs/Web/client/native-application/README.zh.md) 所有。

既有认证 HTTP 用例通过对话控制器验证延迟模型清理下的取消。无密钥 native-web 场景通过已发布 Client roster 驱动构建页面、记录用户可见转录，并在重载后恢复该转录。定向编译与原生依赖检查覆盖变更的 Client 和 resolver 声明。
