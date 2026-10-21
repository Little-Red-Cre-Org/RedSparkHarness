# Agent Note：Native 文件系统沙箱提供方——共享围栏与 Native 生命周期

状态：已实现

[English](2026-10-07-native-fs-sandbox-provider.md) | 中文

## 问题

Native Web 与终端 profile 选择了 `@deepseek-ai/dsh-fs-sandbox`，但该包只公开了 Cordis runtime 清单。因此 Native profile loader 会在激活前拒绝所选文件系统入口；若改选 `fs-local`，写入就不会受到已配置沙箱围栏约束。

## 决策

保留 Cordis `runtime` 入口，并在同一包中增加仅支持 Host 的 `native` 入口。Native 入口要求 Native `sandboxPolicy` 服务并提供唯一的 `fs` 服务。它继承现有 `LocalFileSystemBackend`，因此读取、目标身份、原子写入、观察版本、流与变更锁仍使用同一实现。

Cordis 与 Native 写入和编辑都会调用同一目标检查。该检查使用 `dsh-sandbox` 的 `writableRoots`，以及现有规范化路径与文件系统身份包含关系实现。`read-only` 拒绝变更，`workspace-write` 会在检查包含关系前重新解析目标，`danger-full-access` 则不加路径围栏直接委托。Native 入口不拥有会话策略或批准决策；Native 策略与工具层逐次提供这些值。

Native 安装把取消信号连接到后端关闭，并由安装所有者等待关闭完成。提供方会从策略解析到后端 I/O 跟踪每个已接纳的写入与编辑；关闭开始后拒绝新变更、取消后端工作，并等待策略检查与本地操作都结束后再由 Native Host 所有者释放。

本包将 Cordis、Plugin Host 与旧 `dsh-sandbox-policy` peer 标为 Native-only 安装时可选。这些字段只允许安装器省略 peer；它们不会选择入口，也不会让缺少宿主与策略提供方的 Cordis 入口能够加载。Native profile 必须显式选择 `dsh-native-sandbox-policy`。该提供方不声称实现内核级文件系统隔离；profile 中其他包仍可能需要 Cordis。

## 考虑过的替代方案

**在 Native profile 中使用 `fs-local`，把围栏只留给文件工具。** 不采用，因为未经过 `dsh-tool-fs` 的调用仍可通过文件系统服务写入并绕过沙箱。

## 后果

Native 入口与 Cordis 适配器共享同一写入围栏，因此两者保持相同的模式与目标语义。Native 组合必须显式选择策略提供方；进程内路径检查仍不同于内核隔离。

## 相关决策

- [跨能力族文件沙箱](2026-07-14-cross-family-fs-sandbox.zh.md)——共享模式、逐调用策略与 Cordis 强制入口。
- [Native profile 模板](../../../../rsh/Programs/CLI/src/native-profile-template.ts)——Web 与终端组合中所选的 Host 文件系统提供方。
