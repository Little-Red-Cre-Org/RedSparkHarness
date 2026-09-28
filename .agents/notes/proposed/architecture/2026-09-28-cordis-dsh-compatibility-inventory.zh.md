# Agent Note: Cordis / DSH 兼容清单与交接

Status: proposed

[English](2026-09-28-cordis-dsh-compatibility-inventory.md) | 中文

## Problem

兼容工作需要一份有代码证据的 Cordis/DSH 所属位置图、现有 Loader/HMR/卸载测试覆盖和安全的插件批次顺序。缺少这些信息时，兼容适配可能重复原生权威，或静默扩大不支持的旧接口范围。

## Proposal

以本清单和测试矩阵作为兼容工作的基线。保留已完成的文件系统桥接切片，并维护 native 导出源码映射检查；之后逐个包族验证契约并接入其他 DSH 插件。Native Runtime 公共接口和 Engine/Agent/Session 变更由对应负责人处理。

## 范围与基线

本清单覆盖 `origin/main` `142c9c925c7013087557676a86cad95e41b53dda` 上兼容模块负责的部分。不修改 Native Runtime 公共接口、Agent、Session、Engine，也不修改 vendored Cordis。用户主 checkout 存在本地修改，本工作隔离在 `refactor/cordis-compat-completion` 分支。

原生运行时基础和原生 profile loader 已存在。四个文件系统适配包（`compat-fs-local`、`compat-fs-policy`、`compat-fs-sandbox`、`compat-tool-fs`）现在通过可选的 `compat-dsh-runtime` 挂载；该运行时持有一个共享 Cordis Context，且只允许挂载一方插件 allowlist 中的包。这证明一个封闭能力切片，不代表通用 Cordis 插件加载器已经完成，也不代表生产应用不再依赖 Cordis。当前发布的产品 profile 仍使用旧装配。

## 使用位置与归属

| 区域 | 当前所有者 / 示例 | 迁移安排 |
|---|---|---|
| vendored 框架 | `rsh/Core/vendor/{cordis,loader,include,hmr,group,timer,logger-console}` | 作为固定版本 DSH 实现保留。兼容行为不直接修改 vendor 源码；只有显式选择时才经兼容边界加载。 |
| 旧启动与组合 | `rsh/Compatibility/DSH/boot/{cmdline,app-boot}`；`bundle/{base,web-app,headless,sdk-app,sdk-minimal,acp-app,rsh}`；profile YAML 与 patch 解析 | 留在此处。负责 Cordis 配置解析、旧 profile/bundle 组合、include/group/Loader 接线、Cordis HMR/配置重载和 DSH 启动行为。不能把整个旧 bundle 装进原生 Engine。 |
| 现有 DSH 插件包 | `rsh/Core`、`rsh/Engine`、`rsh/Modules` 和 Web/SDK/ACP 中的大量包仍导出 Cordis 插件、注入 `Context` 服务或订阅 Cordis 事件 | 按能力迁移到原生接口（由原生运行时负责人所有），或在 `Compatibility/DSH/bridge` 中做显式适配。原生包不得为省去适配而直接导入 Cordis。 |
| 原生基础与原生入口 | `Core/runtime-diagnostics/native-runtime`、Engine 原生包，以及 FS/credentials/session 包中的 `./native` 入口 | 保持原生所有权。兼容适配只能消费声明的接口，不能另建 Agent、Session 写入者或工具结果权威。 |
| 应用与传输 | CLI、DesktopHost、Web host/client、SDK、ACP | 当前仍保留 Cordis 依赖。CLI 有原生 profile loader；但应用默认切换、Web/Desktop renderer 和发布运行时闭包尚未形成完整双路径产品。兼容侧负责旧装配，不接管原生应用集成。 |
| 构建、测试、文档工具 | `Tests/test-support`、Cordis 配置/目录生成器与验证器、profile fixtures、浏览器/CLI 测试 | 保留旧 Loader 测试以验证兼容。适当标记为仅开发依赖；它们不能证明产品运行时可脱离 Cordis。 |

简单文本扫描会在很多包里找到 Cordis 字样，但这里不报告源码导入总数：文档、生成目录、测试、peer 声明和真实源码边混在一起。计算包级依赖或宣称某包已脱离 Cordis 前，必须先生成编译器解析的依赖图。

### 源码中的 Cordis / DSH 关键位置

下表是从项目自有 TypeScript 源码中核实的可执行边和类型边，列出主要迁移面。运行 `pnpm run audit-source-import-graph -- --cordis` 可查看 Cordis 包的直接导入、符号名、compiler face、包 owner 和源码位置；`--full` 会打印全部依赖发现项。

当前 AST 清单统计到两套 compiler face 中 1,745 条 Cordis 家族的直接 import/type/re-export/module augmentation 边。计数包含测试源码；同一源码边若同时进入两套 face，会分别计数。因此它不是唯一文件数，也不等同于发布运行时依赖数。

| 位置与源码示例 | 已观察到的 Cordis API / 行为 | Face 与边类型 | B 角色处理方式 |
|---|---|---|---|
| Vendor 框架：`rsh/Core/vendor/{cordis,loader,include,group,hmr,timer,logger-console}/src` | `Context`、`Fiber`、`Service`、`Inject`、`FiberState`；Loader entry/config 组合；Include patch；Group、HMR hook、Timer 与日志服务 | Host runtime + 类型；logger-console 有 shared/browser face | 保持固定版本 vendor 源码不变。只允许旧 DSH 或可选 Compatibility Host 接入；原生 Engine 不应导入。 |
| 旧启动：`rsh/Compatibility/DSH/boot/app-boot/src/index.ts`、`boot/cmdline/src/index.ts`、`rsh/Programs/CLI/src/profile-boot.ts` | Cordis `Context`/`FiberState`；Loader、Include、Group 组装；module augmentation、配置/profile 解析、Timer/HMR 接线和生命周期事件 | Host runtime + 类型，含插件 module augmentation | 启动、配置解析和 Cordis 装配留在兼容边界。CLI 目前仍走这条旧路径；移除应用依赖需要 A 角色集成双路径。 |
| 旧 bundles：`rsh/Compatibility/DSH/bundle/{base,headless,web-app,sdk-app,sdk-minimal,acp-app,rsh}/src` | Cordis Context 类型与 Loader 包 augmentation；按 profile 组合旧插件集合 | 主要是 Host；类型边及 Loader side-effect | 保留为 DSH 兼容组合；不能把整个 bundle 装入 Native Engine。 |
| Engine 服务与扩展包：例如 `rsh/Engine/core/{tools,session,scope,system-prompt}/src`、`Engine/workflow/workflow/src`、`Engine/schedule/schedule/src`、`Engine/preset/agent-presets/src` | runtime `Context`/`Service` 注册和 module augmentation；helper、invariant 中也有仅类型的 Context/Fiber | Host；runtime 与类型边混合。`agent-presets` 还使用 Loader/Include | 原生解耦由 A 角色负责。B 不改这些包；只在双方同意具体 DSH 贡献后提供桥接。 |
| DSH 兼容模块：例如 `rsh/Modules/Official/{workspace,webhook,web,terminal,todo}/**/src` 和 `Modules/Community/experimental/{webworker-runtime,webworker-packer}/src` | Cordis Context/Service 注册和注入服务类型；worker 代码还会动态解析 Cordis Logger/Include 模块 | Host runtime + 类型；worker loader 使用字面量动态引用 | 保持 DSH 现有行为。只有匹配既有 Native service/event 契约后才能逐能力加桥；当前首批仍是 filesystem。 |
| Web Host 与 Client：`rsh/Programs/Web/host/{webserver,plugin-inventory,open-in-app}/src`；`Programs/Web/client/web/src/{seed,boot,boot-client,mount,loader-status}.ts` | Host Context/service 接线；Client 在运行时导入 Cordis、把它放入浏览器模块表，并启动 Cordis Loader | Host 与 Client；都有 runtime 和类型边 | Web 双路径及浏览器产物隔离需要应用负责人集成。Host 包把 Cordis 改为可选 peer 并不能证明 Web Client 已脱离 Cordis。 |
| Desktop Host 接口：`rsh/Programs/DesktopHost/src/index.ts` | Desktop host 接口中使用 type-only `Context` 和 Include `PatchOptions` | Host 类型边 | 类型擦除后没有运行时边，但发布类型闭包仍耦合 Cordis；由应用负责人决定原生侧类型契约。 |
| 测试、fixture 与 benchmark：各包 `tests/`、`rsh/Tests/test-support`、`rsh/Tests/benchmarks` | 创建 Cordis Context/Loader 来测试旧插件、fixtures 和兼容基准 | Host 测试专用 runtime/类型 | 保留为测试/工具边；全量依赖治理时需与随包发布的 runtime 依赖分开分类。 |

源码依赖图记录源码路径、compiler face、解析后的 owner、type/runtime 区分和字面量 loader 目标。它不会猜测计算式 import 的运行时目标，这些边会统计出来供显式策略审查。依赖声明按导入方包自己的 dependency section 核对，不依赖根目录 hoisting。

## 插件迁移顺序

| 批次 | 建议 | 原因与验收边界 |
|---|---|---|
| 1. 文件系统 | 已完成：本地 Provider、观察策略、沙箱 Provider、文件工具 | 作为参考适配器。已有配置/manifest 拒绝、Provider/策略唯一性、模型可见 prompt/schema、单条持久工具结果、拒绝写入不改文件、等待式清理等真实原生宿主与旧插件测试。 |
| 2. Shell 与终端 | 先盘清确切 DSH 包和原生 Runtime seam，再作为候选 | 用户价值高，但涉及进程所有权、沙箱与取消。每次适配一个 Provider/工具家族；不能绕过原生审批或 sandbox 决策。 |
| 3. MCP 与外部 Provider | 明确支持的配置、凭据映射后再纳入 | 生态覆盖广，外部网络与生命周期副作用多。必须有显式凭据所有权、调用边界和卸载行为。 |
| 暂缓 | 整个 `base` bundle、Agent loop、Session/持久化、任意第三方插件、没有原生契约的 Client 插件 | 这些会与原生权威冲突，或尚未映射到明确接口。对不支持的 manifest/config 应拒绝，不能静默忽略。 |

该批次表是优先级建议，并不表示 shell/MCP 适配已经实现。

### DSH 插件矩阵与当前支持范围

下表以 `Compatibility/DSH/bundle/*/cordis.patch.yml`、profile 默认组合及现有 bridge manifest 为证据。它记录的是能力族边界；不能推导出同族所有配置、入口和第三方插件均已兼容。

| 插件/能力族 | 当前旧入口 | Host / Client | Cordis 语义与资源 | 状态与处理 |
|---|---|---|---|---|
| 文件系统 Provider 与策略 | `dsh-fs-local`、`dsh-fs-observation-policy`、`dsh-fs-sandbox`、`dsh-tool-fs`；Native bridge 包分别位于 `bridge/compat-fs-*` | Host；工具桥消费原生 Agent、Tools、Prompt、Session 能力 | Provider、策略/沙箱判断、工具和 prompt 注册；Session 结果持久化由原生服务负责 | **已支持一个受限 filesystem v1 切片**。四个 bridge 有真实 Native Host 测试；manifest/config 拒绝边界以各包 README 和测试为准。不能扩展为任意旧文件系统插件兼容。 |
| Shell / Terminal | `dsh-subprocess-local`、`dsh-bash-sandbox`、`dsh-pwsh-sandbox`、`dsh-tool-bash`、`dsh-tool-pwsh`；`sdk-minimal` 还组合 `dsh-terminal` 与 `dsh-terminal-bash` | Host | 进程/PTY 所有权、审批与 sandbox policy、超时和取消、异步结束清理 | **候选，未桥接**。先拆分进程 capability、策略决策和工具贡献；不能绕过原生审批/沙箱，也不能把 `abort` 视为进程已退出。 |
| LLM Provider 与凭据 | `dsh-llm-deepseek`、`dsh-llm-pi-ai`、`dsh-credentials-local`、`dsh-llm-retry` | Host；部分设置由 Web Client 操作 | Provider 路由/注册、按请求解析凭据、设置重载、请求取消与 provider 生命周期 | **待评估**。保留兼容需原生 Provider 注册和凭据 capability 契约；不得把密钥复制进通用 Cordis Context 或 Browser bundle。 |
| Agent / Session / Tools 核心 | `dsh-agent`、`dsh-agent-loop`、`dsh-session`、`dsh-session-persistence-jsonl`、`dsh-tools` 及各 `dsh-tool-*` | Host；结果通过 Web/ACP/SDK 暴露 | Agent 创建、Session 读写、Tool 执行与结果落盘 | **旧 DSH 中存在；不纳入整体兼容桥**。RSH Native 必须是唯一业务权威。只允许像 filesystem tool 这样的逐项贡献映射到原生扩展点；完整 loop/store/executor 暂不支持。 |
| Web Host / API / Client | `dsh-web-app`、`dsh-host-webserver`、`dsh-api-*`、`dsh-client-*`、`dsh-cordis-client-runner` | Host + Client | Host 服务注册、RPC/事件桥、浏览器模块表和客户端插件生命周期 | **旧产品路径继续使用；尚未原生化**。Host 的 Cordis 可选化不证明 Client bundle 可脱离 Cordis；必须分开制定支持矩阵与产物依赖验收。 |
| ACP / SDK / RSH bundle | `dsh-acp-app`、`dsh-sdk-app`、`dsh-sdk-minimal`、`dsh-rsh` | Host | 启动参数、Loader 组合、Agent/Session/Tool 组装；部分 bundle 自带旧 loop | **旧入口保留；不得整体塞入 Native Engine**。逐包识别是否复用 Native Agent/Session/Tools，冲突核心权威的旧组合排除。 |
| 调度、MCP、外部 Provider、任意第三方插件 | 需按用户 profile 和已安装清单枚举；当前默认 bundle 未形成统一 Native bridge roster | Host，按插件可能另含 Client | 外部进程/网络、凭据、事件回调、并发任务与卸载 | **未纳入首批，配置必须明确拒绝或留在旧 DSH 路径**。需要逐插件确定身份、能力、取消、失败回滚和清理契约后再选批次。 |

### B2 定向测试基线

在当前 worktree 快照运行下列定向套件，11 个测试文件、69 项测试全部通过；本次未跳过测试。该命令在原有九组 DSH 基线上加入了可选兼容 Host 和源码依赖图测试。该结果不代表整仓测试通过，也不代表 Native Runtime HMR 已实现。

```text
pnpm exec vitest run \
  rsh/Tests/test-support/loader-smoke/tests/loader-smoke.spec.ts \
  rsh/Compatibility/DSH/boot/app-boot/tests/hmr-config.spec.ts \
  rsh/Compatibility/DSH/boot/app-boot/tests/config-reload.spec.ts \
  rsh/Programs/CLI/tests/profile-hmr.spec.ts \
  rsh/Core/runtime-diagnostics/plugin-host/tests/plugin-host.spec.ts \
  rsh/Compatibility/DSH/bridge/compat-fs-local/tests/native.spec.ts \
  rsh/Compatibility/DSH/bridge/compat-fs-policy/tests/native.spec.ts \
  rsh/Compatibility/DSH/bridge/compat-fs-sandbox/tests/native.spec.ts \
  rsh/Compatibility/DSH/bridge/compat-tool-fs/tests/native.spec.ts \
  rsh/Compatibility/DSH/bridge/compat-dsh-runtime/tests/native.spec.ts \
  rsh/Scripts/verify-source-import-graph.spec.ts
```

观察边界：Loader smoke 和 app-boot/profile 套件覆盖旧配置、配置重载及 Cordis 组合；plugin-host 覆盖 owner 约束、等待 dispose 和 replacement 的局部语义；四个 filesystem bridge 套件覆盖该切片的 Native Host 行为。该集合不是手册中所有历史 DSH 插件测试的全集，也没有验证 Client HMR 与 Native plugin replacement 等价。

### B3 源码依赖审计状态

当前检查并非空白：`verify-native-dependencies` 使用 TypeScript Host/Client compiler project，解析明确 Native roster 和混合包 native entry 的导入闭包，检查字面量 import/require、type import、import type、re-export、模块声明和字面量 dynamic import；`verify-package-dependencies` 另外从已分类包源码推导依赖；`verify-tsconfig-paths` 检查工作区 `./native` exports 到 `src/` 的别名映射。本分支均有通过记录。

新增的 `pnpm run audit-source-import-graph` 会解析两套 TypeScript compiler face，并使用每个源码文件的有效 TS 配置解析导入边；覆盖普通导入、type import、re-export、module augmentation、import type 和字面量 loader。6 个测试覆盖跨包相对路径 re-export、TS alias、type/runtime 区分、通过 alias 导入 Cordis、计算式 loader，以及 Host/Client alias 实际解析不同目标。加 `--graph` 会将编译面、配置、源码位置、type/runtime、计算式标志和解析到的包目标以 JSONL 输出，摘要写到 stderr；计算式导入只记录位置，不猜测目标。

本分支全仓扫描覆盖 4,146 个 compiler source entry、25,028 条 Host/Client 引用，涉及 314 个 workspace package owner 中的 308 个。未出现在两套 TS face 的 6 个 owner 是平台专用 native addon 包和 Python runtime closure。另记录了 33 条计算式 loader，但没有运行时策略时无法归属其具体目标。修正测试/runtime 依赖分类并补齐 Compatibility manifest 后，仓库仍有 1,177 项发现：822 条外部依赖未声明、172 条 workspace 依赖未声明、183 条源码引用无法由 TypeScript 解析。Compatibility/DSH 目录自身现在没有源码依赖图发现。无法解析项包含合法 CSS 与 Vite 虚拟资源导入。其他 owner 的依赖发现仍需审阅；其中有测试、根目录统一管理的工具和旧 bundle，未经分类不应直接定性为产品缺陷。扫描没有发现 alias 目标不匹配或 Native 越界导入 Cordis。这是完整的 TS 源码发现，不覆盖其他语言，也不是干净的全仓依赖基线或 CI 门禁。Native Cordis 边界仍由 `verify-native-dependencies` 强制检查。

### 接口需求与进入 B4 的判断

现有 Native API 提供 `NativePlugin.resolve(config)`、`NativeHost` 安装计划/激活/移除、host/client target、声明式服务/事件和 `context.own()` disposer。文件系统适配包使用这些契约，没有修改公共接口。兼容运行时校验 Cordis 主版本 4 和一方插件 allowlist；`dsh-plugin-host` 管理子 Fiber 和 descriptor 清理。文件系统 waterfall 事件保留 `next()` 与 actor 参数，观察事件只转发一次到 native scope；不支持的配置在挂载前失败。这些检查只证明所选文件系统语义，不定义通用 scope-to-actor 映射或热替换契约。

所选适配器已在 CLI NativeHost 中用定向测试覆盖，但应用级原生/兼容组合仍由原生运行时负责人集成。不能从这一个切片推出通用 Cordis Host 已完成，也不能宣称产品层面的 Cordis 开关已经完成。

## Loader、HMR 与卸载证据

| 主题 | 已有证据 | 兼容侧仍需补齐 |
|---|---|---|
| Cordis Loader 启动和组合 | `rsh/Tests/test-support/loader-smoke`；app-boot profile/config 测试；`Core/runtime-diagnostics/plugin-host` 启动失败测试；兼容运行时校验 Cordis v4 并挂载现有 plugin-host adapter | 原生兼容运行时不加载旧 Loader profile 或任意包。 |
| 配置 HMR / 重载 | `app-boot/tests/hmr-config.spec.ts` 覆盖路径别名、add/change/unlink、父目录缺失、串行刷新/释放和 watcher 失败；`config-reload.spec.ts`、`CLI/tests/profile-hmr.spec.ts` 覆盖配置与 profile 策略 | 这是旧 Cordis HMR，不是原生插件热替换。原生路径目前没有热替换契约；原生所有者定义替换语义前，不应暴露该能力。 |
| 描述符与 HMR 所有权 | `Core/runtime-diagnostics/plugin-host/tests/plugin-host.spec.ts` 覆盖启动失败、重复所有者、等待清理、替换/启动期间取消、并发替换和重复释放 | Plugin host 是兼容适配器；不能据此推断每个原生桥都支持安全热替换。 |
| 桥接加载/卸载 | 五组兼容 bridge 测试覆盖拒绝、共享 Context 中多插件挂载、独立卸载、部分激活回滚、等待异步清理、文件系统策略、工具/prompt 注册和已接收工作排空 | 接入其他能力族时继续扩展这些断言。 |
| 原生生命周期 | Native Runtime Host 测试覆盖激活回滚、自有资源清理、事件和等待式移除 | 尚无通用 HMR 或外部 DSH 包发现；继续列为明确的后续能力。 |

## 源码依赖审计范围与后续门禁

`verify-native-dependencies` 会按实际解析结果检查明确列入名单的原生/过渡包，并在 Host 与 Client 编译面跟踪原生入口闭包；`verify-package-dependencies` 会按源码推导已分类发布包的依赖。新增的全仓源码图发现工具已覆盖两套编译面，并提供 JSONL 导出供进一步分类；它暂不作为门禁，因为其他目录仍有 1,177 项待分类发现。本分支也将 `verify-tsconfig-paths` 扩展为逐个检查工作区的 `./native` 导出映射到所属包 `src/`，并补齐 native prompt、sandbox policy、凭据入口、Web Client 和四个兼容桥的映射。后续若要把全仓审计升级为强制门禁，仍需：

1. 构建两个 compiler face，并从导入方解析每条边，包含 TS paths、相对路径、package exports 和包自引用。
2. 跨包跟踪 re-export 和可达源码边；分别记录 type-only 与 runtime 边。
3. 根据解析出的目标包检查依赖声明，包括未声明的跨包相对导入。
4. 用明确策略 roster 区分 Core、Engine、Modules、Programs、Compatibility、测试、生成文件和 vendor。
5. 拒绝原生 roster 中的 Cordis 源码、类型和 module augmentation 边；只在 `Compatibility/DSH`、明确标记的旧包和测试 fixture 中允许。
6. 加入负例：alias 越界、`../` 越包、re-export 链、`import type`、计算式 import、manifest 缺依赖，以及 Host/Client 不同解析结果。

## 本分支验证结果

- 当前 DSH/HMR/兼容层及源码图定向验证通过：11 个 Vitest 文件、69 项测试，无跳过；Native Cordis 和包依赖策略检查通过。
- `tsc -b tsconfig.host.json` 和 Host `tsdown` workspace 构建通过。
- `verify-native-dependencies` 的 Host/Client 原生依赖图通过；`verify-package-dependencies` 检查 62 个发布包；lockfile 离线 frozen 校验通过。
- alias 与模块图重新生成后，`verify-tsconfig-paths` 和 `verify-module-graph` 通过。无 Cordis 原生 profile 和启用兼容模块的 profile 仍是两条独立路径；当前测试不证明 CLI/Web/Desktop 已完全脱离 Cordis。
- 源码图审计现在覆盖两套 compiler face 和跨包解析；全仓仍有 1,177 项发现待 owner 分类与治理（822 外部依赖未声明、172 workspace 依赖未声明、183 未解析引用）。Compatibility/DSH 自身为零发现。审计目前是信息报告，不是门禁。B3 的发现工具已完成；全仓依赖清理和应用层 Cordis OFF/ON 验收仍未完成。

在包清单完成前，不要全仓禁止 Cordis；否则门禁要么破坏仍受支持的 DSH 行为，要么堆积无界例外项。

## 已有接口交接

兼容工作应消费而非重定义现有 API：`NativePlugin.resolve(config)`、`NativeHost` 安装计划/激活/移除、显式 host/client target、声明式服务/事件、作用域事件分发，以及 `context.own()` disposer。每个 DSH 包接入前，记录支持的旧 manifest/config 版本、所需原生服务、policy/actor 映射和拒绝行为。缺失契约交回原生运行时负责人；兼容层不能增加第二套生命周期或放宽安全策略。

## Acceptance criteria

- 在增加新插件批次前，先在分支提交本清单和测试基线矩阵。
- 每个桥都保持 opt-in 且限定到具体包；不支持的版本/配置必须在获取资源前失败。
- 测试成功加载、部分设置后的加载失败、已有异步工作期间卸载、无残留注册；适用时使用真实 Loader 组合和真实旧实现。
- 文档逐项列出已支持 DSH 插件与已知不支持的形态。在原生负责人接好并验证完整原生/兼容应用路径前，不宣称产品层面 Cordis 已可选化。

## Alternatives considered

**加载整个旧 base bundle：**拒绝，因为它可能引入彼此竞争的 Agent、Session 和工具权威。

**清单和卸载基线完成前就开始接入新插件家族：**拒绝，因为各包的配置、策略、异步工作和清理义务不同。

## Risks

现有 compiler-aware 门禁只覆盖明确名单，不覆盖全部源码所有者。要让更广泛的门禁拒绝仓库里的 Cordis 导入，必须先评审所有权清单并加入负例。Cordis HMR 覆盖也不等同于原生热替换能力。
