# Agent Note：原生本地子进程提供方

状态：已实现

[English](2026-09-27-native-subprocess-provider.md) | 中文

## 问题

本地 subprocess 提供方把进程包含和清理实现放在 Cordis `Service` 子类中。原生 Host 无法在不加载 Cordis 的情况下安装它，子进程环境辅助函数也导入旧服务入口。底层 Win32 进程包虽然没有 Cordis 源码依赖，仍声明了 Cordis peer。

## 决定

[`dsh-subprocess`](../../../../rsh/Core/subprocess/subprocess/README.zh.md) 从 `./native` 导出不依赖 Cordis 的 `SubprocessOperations` 定义和子进程环境辅助函数。[`dsh-subprocess-local`](../../../../rsh/Core/subprocess/subprocess-local/README.zh.md) 由 Cordis 适配器和原生 Host 提供方共用一个本地进程控制器。两个入口使用相同的可执行文件查找、受管进程范围选择、PTY 行为、宿主退出最终清理和等待式资源释放。原生入口拒绝配置，因为每项进程选择都属于 spawn 请求。它通过 Node 进程警告报告较弱的进程包含；Cordis 适配器继续使用原有日志警告。[`dsh-win32-process`](../../../../rsh/Core/subprocess/win32-process/README.zh.md) 不再声明 Cordis peer，原生依赖检查会检查其源码和必需依赖。

## 考虑过的替代方案

**为原生 Host 复制本地进程实现：** 两个入口会分别拥有进程包含和清理行为，后续修复可能让其中一个运行时留下较弱的进程所有权。

**在原生提供方中封装 Cordis Service：** 这仍会在原生安装中引入 Cordis，无法通过独立生产依赖检查。

## 结果

原生 Host 可以在不导入 Cordis 的情况下注册并停止本地 subprocess 服务。构建后的原生定义与提供方通过拒绝 Cordis 解析的独立 Node 导入检查；原生生命周期测试会启动真实子进程并等待停止。现有 Cordis 消费方保留原来的服务方法与测试入口。本次改动不切换默认 headless profile；其余 shell 和搜索消费方必须先迁移，才能满足该 profile 的完整行为清单。
