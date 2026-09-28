# Agent Note: RSH 原生运行时与可选 Cordis 兼容

Status: proposed

[English](2026-09-22-rsh-native-runtime-and-optional-cordis.md) | 中文

## Problem

运行时角色元数据描述了所有权，但执行仍由 Cordis 负责，产品包也仍依赖它。[早期提案](2026-09-21-rsh-runtime-layers-and-cordis-adaptation.zh.md) 保留 Cordis 作为唯一框架。可选兼容分发要求独立的原生执行能力，同时不能复制 Agent、Session 或工具权威。

## Proposal

构建 RSH 原生运行时，迁移完整能力和应用装配，并通过显式选择的官方兼容模块接入 Cordis。这是一项迁移决策，不表示当前 profile 已经原生化。保留包名、受支持的 profile 启动、工具行为、审批与 sandbox 策略、Session 历史代际以及两套 SDK 投影。早期提案的角色分类和依赖规则仍适用于现有装配；本提案仅替代其唯一框架决策。

### 职责与依赖

| 所有者 | 职责 | 允许的依赖方向 |
|---|---|---|
| Core | 通用安装、服务、事件、作用域、资源与诊断 | 原生 Core 和已声明的受维护依赖；不依赖 Engine、Module、Program 或兼容实现 |
| Engine | 唯一的 Agent 循环、Session 历史、工具执行与工作流权威 | 原生 Core 与公开能力 Definition；不选择具体 Module Provider |
| Modules | 能力 Definition、Provider、Consumer、策略与投影 | 公开 Definition 和注册表；Consumer 不选择或导入其 Provider |
| 官方兼容模块 | 适配选定的旧贡献、配置与自有资源 | 公开原生接口与显式启用的 Cordis 实现；不建立第二套可写 Engine |
| Programs | CLI/profile 装配、Host、Client、传输与呈现 | 公开原生 API 和选定的 Provider；兼容能力由部署显式选择 |

一项验收能力包含其 Definition、选定的 Provider 和真实 Consumer，以及必需的策略与投影。停用兼容层不得移除审批约束、扩大文件系统或进程访问权限，也不得静默选择无限制 Provider。同进程插件仍是可信代码；作用域可见性不是操作系统 sandbox。

### 原生接口与执行语义

首版接口必须提供以下操作。名称是 API 设计目标；P1 负责实现及独立消费者的声明检查。原生执行协议版本与 `dsh.runtime` 角色元数据、持久化 Session 版本保持独立。

| 接口 | 必需行为 | 失败与完成规则 |
|---|---|---|
| 安装请求与已解析计划 | 显式声明插件、目标、作用域、配置、必需/可选服务及所提供的服务 | 激活前拒绝不受支持的版本/目标、重复 Provider、缺失依赖和循环；解析配置时不获取资源 |
| 服务获取与发布 | 只读取已声明依赖；选择最近的可见 Provider；显式表达可选依赖缺失 | 激活成功且全部承诺服务存在后才发布；不暴露半初始化服务，也不创建兜底 Provider |
| 作用域与发起者 | 分离可见性祖先关系、安装实例资源所有权和发起调用的 Agent/工具执行 | 独立根隔离 realm；并行调用方在异步工作中保留各自的发起者；适配不能从注册所有者推断调用方身份 |
| 自有注册与资源 | 立即记录所有权；返回幂等且可等待的 disposer | 激活失败只撤销自己的注册；清理尝试释放全部资源并聚合失败 |
| 启动、移除与停止 | 先启动依赖再启动 Consumer；移除选定 Provider 时连同依赖它的 Consumer 一起移除；取消前先停止接收新工作 | 等待启动、已接收工作与清理完成；先释放 Consumer 再释放 Provider；发出关闭信号本身不代表完成 |
| 诊断 | 暴露安装身份、作用域、状态、依赖选择、失败与清理结果 | 区分计划、激活、就绪、排空、失败与已释放状态；不发布含密钥的配置值 |

Engine 所有者定义业务静止顺序：停止接收 turn 和工具工作，取消或完成自有执行，提交产生的 Session 事件，刷新持久化，再释放底层服务。通用的反向释放不能代替这个顺序。回滚针对注册与资源；已完成的文件写入、网络副作用和持久化事件不会自动撤销。

| 事件模式 | 顺序与返回 | 错误与取消语义 |
|---|---|---|
| 同步通知 | 按注册顺序执行；调用方不等待监听器返回的 Promise | 按事件所有者要求传播监听器抛错，包括文件系统观察事件 |
| 并行异步分发 | 接收选定监听器并等待全部已接收回调 | 所有回调结束后才报告失败；取消停止接收新调用，但仍排空已接收工作 |
| 串行异步分发 | 按顺序等待监听器 | 首次拒绝即停止，并保留调用方的失败 |
| Waterfall | 仅通过显式 `next()` 继续；不调用即短路，重复委托会拒绝 | 等待已委托工作，保留中间件恢复逻辑与调用方选定的结果/错误；不进行无条件双向桥接转发 |

配置重载与插件替换必须在 live Web profile 切换前保留其受支持行为。替换流程先关闭旧实例接收入口，并在发布后继实例前完成冲突资源清理。替换失败时报告失败，不静默恢复不兼容或已部分释放的装配。

### 元数据与 profile 配置

新增 `package.json.dsh.native` 声明，字段为 `apiVersion: 1`、`entry`（已导出的包子路径）、`targets`（`host` 和/或 `client`），以及服务名数组 `requires`、`optional` 和 `provides`。入口导出 `plugin`，其原生协议声明必须与元数据一致。其 `resolve(config)` 操作校验配置并返回激活数据，不获取资源。未知版本、无效导出和不受支持的目标在激活前失败；可静态判定的元数据错误在导入插件代码前失败。保留 `dsh.runtime` 作为角色元数据，含义不变；npm、原生 API、DSH 兼容和 Session 版本分别管理。

通过 `dsh.profile.runtime: "native"` 和 `dsh.profile.config: "rsh.profile.json"` 选择原生装配；迁移期间未填写 runtime 时保留现有 legacy 解释方式。`rsh.profile.json` 是 JSON，字段为 `formatVersion: 1`、`scopes` 和 `installations`。作用域行包含唯一 `id` 和可选 `parent`；安装行包含唯一 `id`、包名 `plugin`、`scope`、可选 `config` 和可选 `disabled`。根作用域省略 `parent`。拒绝未知字段、缺失引用及作用域环；`disabled: true` 在依赖规划前排除该行。包元数据负责解析导出入口；用户配置不能选择任意模块路径。部署选择 Host 或 Client，并据此校验每个选中入口。

保留 `dsh --profile` 和现有 `--patch` 选项。原生 profile 的 patch 为 JSON，包含 `formatVersion: 1` 及按已有安装 `id` 索引的 `installations` 行；每行替换完整 `config` 值和/或设置 `disabled`。拒绝重复或未知 id、未知字段、可执行 YAML 及隐式 Cordis 解释。解析计划前按参数顺序应用显式 patch。legacy bundle、home 和 profile Cordis patch 仍由兼容解释器负责；迁移必须预览并显式映射适用值，或拒绝不支持的输入，不能静默忽略用户已有 patch。P1 负责协议声明与校验；P2 在启用原生启动前同步更新 manifest reader、profile 解析、生成器和消费者。不引入新的 CLI 参数或可执行文件。

### 首批兼容范围

以下是选定的首批兼容目标，不代表原生桥当前已经支持它们。桥必须为每个作用域选择一个 Provider，为每种事件选择一个权威方向；原生与旧贡献不能同时执行或记录同一操作。

| 旧目标 | 必需原生接口 | 验收 / 拒绝条件 |
|---|---|---|
| `rsh/Modules/Official/fs/fs-local` | 文件系统 Definition、自有 Provider 注册与取消 | 旧 Provider 可服务不变的原生 Consumer；重复 Provider 在激活前失败 |
| `rsh/Modules/Official/fs/fs-observation-policy` | 文件系统决策/观察事件与发起会话身份 | 保留未观察/不存在/存在的区分、陈旧版本防护与按会话隔离；卸载只丢弃该策略的状态 |
| `rsh/Modules/Official/fs/tool-fs` | 原生 Tools 和 System Prompt 注册表、文件系统、执行 actor、可选附件与审批能力 | 工具只注册/执行一次，模型可见结果只持久化一次；缺失必需能力会拒绝，可选附件缺失保留现有行为 |
| `rsh/Modules/Official/fs/fs-sandbox` | 共享本地存储与原生 sandbox 策略解析 | 被拒绝的变更不改变文件；不自动降级为裸本地存储 |
| 整个 `rsh/Compatibility/DSH/bundle/base` | 包含 Engine 权威与完整产品装配 | 不在桥内加载；选择性适配受支持贡献，不创建第二套循环或存储 |
| 未声明插件、不受支持的版本或配置构造 | 显式的受支持 adapter 与映射 | 明确指出插件/字段并拒绝；不静默省略，也不猜测性模拟私有 API |

### 迁移负责人和阶段出口

每个阶段以独立 PR 完成开发、验证、提交和推送。持续修复审查发现并重新验证，直到该阶段可以合并。只有合并后，下个阶段才从刚拉取的 `origin/main` 开始。已有后续阶段原型单独保留，仅在其阶段开始时纳入。

| 阶段 / 负责人 | 路径与交付物 | 前置条件 / 出口证据 |
|---|---|---|
| P0 / 实施负责人 | 本决策：职责表、执行语义、兼容范围、迁移负责人、基线选择与接口交接 | 评审设计并执行选定的现有装配基线；合并文档 PR |
| P1 / 实施负责人 | `rsh/Core/runtime-diagnostics`、`rsh/Scripts`、workspace/编译器/构建接线：独立运行时、诊断、生命周期夹具与依赖检查 | P0 已合并；有效/无效依赖图、生命周期、事件、作用域用例及打包原生库消费者；精确的源码/类型/manifest 规则在顶层检查中执行 |
| P2 / 实施负责人 | `rsh/Modules/Official/fs`、最小 `rsh/Engine` 权威、`rsh/Programs/CLI` profile 与 `snapshots`：真实原生 filesystem/headless 流程 | P1 已合并；通过受支持 profile 入口验证真实文件、工具执行、日志、持久化、取消、恢复与退出；只替代外部模型；证明未创建 Cordis Context |
| P3 / 实施负责人 | 官方兼容模块与上述选定矩阵 | P2 已合并；旧插件消费原生服务，原生注册表消费旧贡献；版本/配置拒绝，无重复权威/事件，可等待卸载 |
| P4 / 实施负责人 | 其余 `rsh/Engine`、`rsh/Modules`、`rsh/Programs/Web`、Desktop、SDK、ACP 与 TUI 所有者 | P3 已合并；完整能力迁移，发起者/并发/安全行为，受支持的重载与替换，Host/Client 启动及两套 SDK 投影 |
| P5 / 实施负责人 | profile 默认值、包 manifest/导出、编译面、打包与分发 | P4 已合并；默认切换前完整目标 profile 通过验收；已安装生产依赖闭包和公开声明无需 Cordis/桥即可工作；包含浏览器和 renderer |
| P6 / 实施负责人 | 所属文档、生成目录与最终需求/证据审计 | P5 已合并；每项承诺入口、数据行为、负向依赖夹具和平台声明均有匹配证据；删除过时迁移例外并合并交付 PR |
| B1 / 外部协作者 | Cordis/DSH 使用与插件清单，按原生迁移、兼容保留、测试工具分类 | 不属于本实施任务；交付发现影响具体迁移时再纳入 |
| B2 / 外部协作者 | Loader/HMR/卸载专项基线与缺口调查 | 不属于本实施任务；产品切换前仍须通过实现测试验证受支持的重载/卸载行为 |

B1/B2 是已分派的交付物，不是暂停已授权路线的前置条件。其余 B 工作，包括依赖检查反例和兼容夹具，在需要时由实施负责人承担。实施负责人在 P4 随所属能力迁移逐条处理 `rsh/Scripts/check-workspace-constraints.ts` 中的六条 `runtimeLayerExceptions`。任何残留例外都必须在 P5 前明确具体路径、负责人和删除阶段；不接受无限期的大范围 allowlist。

切换 profile 前提供配置迁移预览与备份，并保留可重现的已验证版本和显式旧 profile 以供回滚。回滚选择已验证的版本/装配，不静默替换 Provider，也不假设旧构建能读取新写入的数据。

### 基线与交接证据

P0 回归基线使用下列已有插件宿主所有权测试、真实 filesystem Loader 装配与 base bundle 装配。它证明起始版本具备的兼容行为，不证明原生执行。Provider、策略与数据专用测试会在修改其所有者的阶段重新选择；基线通过不能证明后续迁移。

```sh
pnpm exec vitest run rsh/Compatibility/DSH/bridge/compat-plugin-host/tests/plugin-host.spec.ts rsh/Modules/Official/fs/tool-fs/tests/runtime-loader-composition.spec.ts rsh/Compatibility/DSH/bundle/base/tests/base.spec.ts
```

P1 向 P2/P3 交付公开计划、服务、作用域/发起者、事件、配置、诊断和可等待释放接口，以及确定性生命周期夹具。P2 增加具有文件系统与持久化 Session 断言的真实 profile 夹具。P3 增加受支持桥接矩阵及拒绝用例。测试使用可观察的就绪条件和受控 barrier；经过一段时间、发出 abort 或启动进程都不足以证明完成。

## Alternatives considered

**仅保留 Cordis 上的角色描述符：** 能记录所有权，但保留强制框架依赖，无法支持纯原生部署。

**在旧 base bundle 旁运行新循环：** 会产生竞争的 Agent、工具和 Session 权威，使日志、取消与恢复含糊不清。

**替换全部包后才验证产品路径：** 会推迟发现策略、生命周期、Client 与 SDK 回归。完整能力切片可以更早提供行为证据。

**将源码测试视为分发验收：** 编译器别名和已安装的 workspace 依赖可能掩盖声明、导出与生产依赖闭包缺陷。因此需要单独的打包消费者证据。

## Acceptance criteria

- P0 完成意味着其表格、接口义务、兼容选择、委外交付排除项与已执行基线经过审查，且 PR 已合并；这不代表 P1–P6 完成。
- 原生 Core、Engine 与已迁移 Modules 排除 Cordis/桥的源码导入、类型引用和必需生产依赖；检查解析别名、子路径、动态加载与模块扩展，并拒绝非法夹具。
- 真实原生 filesystem 与 headless profile 使用唯一 Engine 权威执行、记录、取消、恢复和关闭，保持审批/sandbox 决策及 Session 历史代际。
- 兼容能力显式选择、受支持矩阵约束、拒绝不支持的输入，并释放自己的贡献，不重复执行或持久化记录。
- CLI、Web、Desktop/renderer、TUI、ACP 与两套 SDK 保留受支持行为，包括适用的配置重载和插件替换。
- 打包的纯原生消费者无需 Cordis 或桥即可编译运行；最终文档区分已验证的 Windows 结果与未在本地执行的平台覆盖。

## Risks

框架耦合可能隐藏在类型、manifest、生成产物、发起者传播和释放过程中，而不只是直接 import。仅后端成功可能掩盖工具策略、Client 呈现或 SDK 投影缺失。旧行为在完成映射实现与测试前必须明确拒绝。保留历史数据，但写入成功不代表旧版本今后能读取新数据；本迁移避免无必要的格式变化。
