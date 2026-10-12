# Agent Note: Confine native SDK child paths under the process sandbox

Status: implemented

[English](2026-10-12-native-child-process-sandbox.md) | 中文

## 问题

Native SDK child launcher 会在宿主临时目录下创建提供方 overlay 与私有 home。workspace-write bwrap profile 会替换 `/tmp`，使受限 child 无法访问这些文件，也无法访问位于 `/tmp` 下的所选 cwd。

## 决策

`ProcessSandbox.confineChildProcess` 会将 child 规范化后的 cwd、launcher 所有的私有 home 与已解析文件策略一并传入。`sandbox-local` 会保持所选 cwd 可见且只读，除非现有策略授权覆盖该路径；同时为 child runtime 所需的精确私有 home 授予写访问。bwrap workspace-write profile 保留临时 `/tmp`，通过只读绑定重新暴露所选 `/tmp` cwd，随后再应用已授权的工作区与私有 home 绑定。

普通 `confine` 路径与 `SandboxPolicy` 保持不变。SDK launcher 仍负责创建和删除私有 home；sandbox 清理不会替代这一所有权。bwrap workspace-write profile 会继续隐藏宿主 `/tmp` 的同级路径。Linux 必需 CI lane 会在 pinned runner 的功能探测通过后执行两个真实 bwrap child 场景。

## 考虑过的替代方案

**将宿主临时根目录绑定到 child 中。** 这会暴露同级临时路径，削弱临时 `/tmp` 提供的隔离。

**将 child home 放在父工作区下。** 这样会通过父级更宽的工作区授权使私有提供方状态可写。

## 后果

Native SDK child 启动后，可以在 bwrap 安装 workspace-write profile 时读取精确的提供方 overlay。父工作区授权仍取决于现有 Native Headless 文件工具权限，同级临时路径仍不可见。Windows ACL runner 保持其已报告的部分强制执行状态。
