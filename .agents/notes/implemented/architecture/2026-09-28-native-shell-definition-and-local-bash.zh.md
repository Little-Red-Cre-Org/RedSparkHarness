# Agent Note：原生 shell 定义与本地 Bash Provider

Status: implemented

[English](2026-09-28-native-shell-definition-and-local-bash.md) | 中文

## Problem

原生 subprocess 与进程沙箱服务需要能够脱离 Cordis 加载的 shell 请求、结果和后台句柄类型，才能支持命令工具。旧 Bash 执行器已有命令执行机制，但导入其服务类会将 Cordis 带入原生 profile。

## Decision

[`dsh-shell/native`](../../../../rsh/Modules/Official/shell/shell/README.zh.md) 不导入 Cordis，导出 `ShellOperations` 以及现有的请求、结果、进程与渲染定义。根入口保留旧版 `ShellExecutor` 服务。

[`dsh-bash-local/native`](../../../../rsh/Modules/Official/shell/bash-local/README.zh.md) 基于必需的原生 `subprocess` 服务安装 `shell`，并在规划阶段验证显式预算。Cordis 适配器与原生 Provider 共用一个控制器，处理请求解析、环境变量顺序、前台超时分类与后台输出读取。subprocess Provider 继续负责进程范围终止和清理。

[`dsh-bash-sandbox/native`](../../../../rsh/Modules/Official/shell/bash-sandbox/README.zh.md) 要求原生 `subprocess`、`sandbox` 和 `sandboxPolicy` 服务。Cordis 与原生入口共用一个控制器，处理按调用解析策略、runner argv、拒绝分类及 runner 故障报告。受限调用在 runner 选择或执行失败时绝不退回无隔离 Bash；只有显式的 `danger-full-access` 策略绕过 runner。

[`dsh-tool-bash/native`](../../../../rsh/Modules/Official/shell/tool-bash/README.zh.md) 消费选定的原生 shell 与工具注册表。前台结果沿用旧版渲染器。安装原生任务服务后，后台进程归发起调用的 Agent 持有，任务注册表负责取消与保存完成输出。升权先验证模式严格拓宽并请求原生应用审批，再将单次调用策略交给 shell；应用把工具与审批事件写入 Session，并在工具结果元数据中保留带错误码的 runner 故障。

[`dsh-shell-env/native`](../../../../rsh/Modules/Official/shell/shell-env/README.zh.md) 为每次原生 Bash 调用提供受管 `DSH_*` 事实。Bash Consumer 导入 `dsh-shell-env/definition`，不依赖其 Provider 类。Cordis 和原生 Provider 共用键所有权校验与按调用收集机制。Cordis effect 与原生 contributor 的安装作用域分别持有释放函数。

## Alternatives considered

**在原生 profile 中导入旧服务：** 这会执行 Cordis，无法形成不依赖 Cordis 的包闭包。

**复制命令实现：** 两份实现可能在超时原因、环境变量优先级或后台输出消费上分化。

## Consequences

原生 Bash 与 PowerShell 注册标准前台/后台值贡献。原生和 Cordis 消费者均使用 shell 定义的前台投影，保留各项独立命令结果并排除提供方自有的额外属性。输出 schema 保留截断文件位置与可选沙箱诊断；呈现继续使用现有模型文本。未声明的升权/后台参数在审批或执行前由注册表校验拒绝。通过 schema 准入的目标仍须检查模式严格拓宽。PTC 绑定与有序嵌套调用仍需独立完成。

原生本地 Bash Provider 不实施隔离，因此不会作为受限策略工具的默认选择。原生后台输出在进程结束后可用。旧执行器保留各自的设置段，并与原生 Provider 共用对应的控制器。

Bash 配置在省略可执行文件时解析为 `bash`，并接受经过校验的显式 `bashPath`，与 PowerShell 的可执行文件选择对应。同一选定 argv 在受限封装之前经过本地及沙箱提供方；运行时选择不能授予文件系统访问权限。原生 SDK 对私有补丁运行时的验收仍是独立的产品验证义务。
