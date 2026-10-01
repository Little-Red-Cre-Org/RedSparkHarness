# Agent Note：Cordis 兼容清单与 Loader/HMR 基线

状态：已实现

[English](2026-10-01-cordis-compatibility-inventory.md) | 中文

## 问题

原生运行时迁移需要一份当前可审查的 Cordis 与 DSH 使用边界。仅看 package manifest 无法区分生产兼容代码、仍保留旧边的原生包和只用于测试的 Loader 组合。Loader、Include、HMR 与卸载行为也需要一份有证据的基线，避免兼容模块悄悄变成第二套原生权威。

## 决策

`rsh/Scripts/compatibility-inventory.ts` 是 B1/B2 的清单权威。它把 compiler face 的源码 import graph 与 workspace manifest 合并，报告声明 Cordis/DSH 依赖、直接使用 Cordis 源码或被原生包策略覆盖的每个包。每行分类为 `native-migrated`、`native-mixed`、`framework-free`、`compatibility-retained`、`test-tooling` 或 `migration-required`。每行保留包版本、角色、能力、原生入口及目标、旧 main 入口、Client 平台，以及每个 Cordis 依赖的 section、版本范围和可选状态。生产与测试 Cordis 使用分开计数；`--uses` 打印文件、行号、compiler face、导入种类和符号；`--json` 返回结构化观察结果。

基线记录四项兼容能力：Cordis Loader 激活与 Fiber 释放、Include YAML 组合与 patch 分层、文件／配置 HMR 刷新，以及兼容插件的所有权与卸载。证据和测试仍位于 `Core/vendor`、`Compatibility/DSH` 以及 filesystem Consumer 的真实 Loader 装配中。原生安装计划和 `NativeContext` 释放是独立机制；清单不会把 Cordis Loader 或 HMR 实现标为原生运行时代码。

报告将策略覆盖的原生导出（包括混合包子路径）与剩余旧依赖图分开。`framework-free` 表示没有直接生产 Cordis 使用或声明的生产 Cordis 依赖，不证明传递依赖闭包独立。原生替换以及变化的模块代码或 Client 组合的自动交付，需要通过各自应用启动入口验证。Cordis HMR 测试不能证明这些机制。兼容 adapter 可以消费原生服务，但不能创建第二套 Agent、Session 或 Tools 权威。

首批兼容范围是 [compat-dsh-runtime](../../../../rsh/Compatibility/DSH/bridge/compat-dsh-runtime/README.zh.md) 提供的 Host filesystem 能力族：选定的旧 filesystem Provider、观察策略、sandbox 策略适配，以及向原生注册表贡献的文件工具。该范围保留原生审批与 sandbox 决策，并拒绝变化的声明或不支持的配置。任意插件、完整旧应用 bundle、Client 兼容和原生 profile HMR 均不在范围内；Cordis Loader/HMR 基线证据不能证明这些路径受支持。

当前 checkout 的 Cordis manifest 选择 `4.0.2`；桥验证主版本 4，不承诺每个主版本为 4 的发行版都经过测试。每个选定的 DSH adapter 在挂载前验证所需 runtime 角色与能力。包版本和依赖范围来自生成清单；npm 版本、原生 API 修订与 Session 格式版本是独立权威。

## 考虑过的替代方案

**维护手写的包清单：** 否决，因为 manifest 看不到源码级类型／值 import，迁移变更会让清单漂移。

**把所有 DSH 包都标成原生：** 否决，因为 `dsh.native` 声明不能消除仍存在的 Cordis 边；报告必须暴露剩余迁移工作。

**把 Loader/HMR 移入原生 Core：** 否决，因为这些实现拥有 Cordis 配置和 Fiber 语义。原生替代物需要独立的安装、替换和排空契约。

## 结果

`pnpm exec tsx rsh/Scripts/compatibility-inventory.ts` 为维护者提供一个可重复的 B1/B2 报告，并在证据路径消失时失败；审查者需要每个文件、行号、face 和导入符号时可追加 `--uses`。报告刻意作为当前状态诊断，不作为完成声明：在 P1–P6 迁移包和源码前，`migration-required` 行及原生 HMR 缺口会持续显示。脚本复用 source graph 权威，因此原生 Cordis 边界仍由 `verify-native-dependencies` 管理。

## 验证

清单测试覆盖分类、生产与测试使用、可选与开发依赖、插件入口元数据，以及源码或回归证据缺失。`pnpm exec tsx rsh/Scripts/compatibility-inventory.ts --uses` 从当前 checkout 生成文件级报告。计数包含在不同 compiler face 中重复的观察结果；迁移后重新生成报告，不把记录的数量当作验收标准。

五项基线测试通过 `pnpm exec vitest run rsh/Compatibility/DSH/bridge/compat-plugin-host/tests/plugin-host.spec.ts rsh/Compatibility/DSH/boot/app-boot/tests/config-reload.spec.ts rsh/Compatibility/DSH/boot/app-boot/tests/hmr-config.spec.ts rsh/Compatibility/DSH/boot/app-boot/tests/user-patches.spec.ts rsh/Modules/Official/fs/tool-fs/tests/runtime-loader-composition.spec.ts --reporter dot`，共 59 个用例。它们在 Windows 验证 Loader 启动失败、事务替换与回滚、patch 分层、文件监视器、异步清理、取消或竞争的 HMR owner，以及真实 filesystem 工具的配置与释放。基线不宣称 Linux/macOS 证据或原生 profile 替换支持。
