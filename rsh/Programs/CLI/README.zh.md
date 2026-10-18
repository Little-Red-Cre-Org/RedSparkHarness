# `@deepseek-ai/dsh`

[English](README.md) | 中文

`dsh` 是唯一受支持的 Node 应用启动器；profile 由多个插件组合包 patch 层按顺序叠加而成，其上再应用用户自己的覆盖配置。SDK 与 ACP（Agent Client Protocol）都是 profile，而不是独立的公开可执行命令。Python 运行时 wheel 包中也包含同一个命令；SDK 默认使用 `sdk`，极简示例选择 `sdk-minimal`。Windows 上可选的 `rsh` Shell shim 会路由到源码中的 `dsh --profile rsh` 启动器，并不会引入第二个 Node 应用表层。[`src/args.ts`](src/args.ts) 负责命令语法，[`src/bin.ts`](src/bin.ts) 只加载选中的运行器。无效命令、来自其他模式的选项、配置错误和启动失败都会以非零状态退出。

## 入口模式

| 命令 | 用途 |
|---|---|
| `dsh --profile <name>` | 启动位于 `$DSH_HOME/profiles/<name>` 的指定 profile。 |
| `dsh --profile <name> --from-default-profile <template>` | 从随附模板创建新的自定义 profile，然后启动它。 |
| `dsh --profile acp` | 通过 ACP stdio 为自动化客户端提供服务，直至断开连接。 |
| `dsh --profile headless "job"` | 运行一个全新的持久化会话，打印最终答案并退出。 |
| `dsh --profile native-headless-query "job"` | 运行 Native headless Session，并启用授权范围限于工作区的既往会话查询工具。 |
| `dsh --profile rsh` | 打开持久化 RedSpark 终端会话。 |
| `dsh --profile sdk` | 通过 JSON-RPC stdio 为 SDK 客户端提供服务，直至关闭或断开连接。 |
| `dsh --profile native-sdk` | 通过 JSON-RPC stdio 提供文本与图片 SDK 轮次、实时模型分块、Session 取消、下一步引导与已结束轮次分叉。 |
| `dsh --profile native-acp` | 通过标准 ACP 标准输入输出驱动原生文本／图片 Session、模型配置、取消与持久恢复。 |
| `dsh --profile sdk-minimal` | 以独立极简 agent（智能体）配置树为 SDK 客户端提供服务。 |
| `dsh web` | `--profile web` 的别名。 |
| `dsh plugin --profile <name> <pnpm args>` | 通过在 profile 目录中转发给 pnpm 来管理该 profile 的插件。 |

运行命令时所在的目录将作为默认 workspace 根目录。新建的 `headless`、`web`、`sdk`、`acp` 和 `rsh` profile 分别初始化为 `native-headless`、`native-web`、`native-sdk`、`native-acp` 和 `native-tui`，同时保留请求中的 profile 名称。八个 `native-*` profile 仍可显式选择，`sdk-minimal` 仍是 legacy profile。已有 `package.json` 会保留所选 runtime，初始化不会改写它。使用 `--from-default-profile` 和未使用的自定义名称（如 `legacy-web`）可从随附 Cordis 组合包模板创建 legacy profile；`dsh plugin` 则可初始化以 base 为基础的 legacy profile。`desktop` 名称保留给 Electron 持有的 profile，因此 CLI（命令行界面）会拒绝针对它的启动、配置 dump 和插件管理请求。

`native-headless`、`native-headless-query`、`native-tui` 和 `native-web` 会话默认值使用随附 pi-ai 的 `deepseek` 路由和 `deepseek-flash` 模型。Native ACP 保留显式的 `deepseek-official` 路由。

native-sdk 配置还组合 native-tools、native-prompt、native-subagent、native-jobs 及其工具消费者。子执行使用相同的选定 Program 执行器、Session 存储与模型提供者。该 profile 提供可续接 Subagent 支持：`subagent` 启动持久子任务，`send_message` 发送后续工作，`interrupt_agent` 中断其当前回合。一次性后台子任务通过 `job_output`/`job_kill` 查看或停止。

`native-sdk`、`native-sdk-dsh-child`、`native-acp` 与 `native-acp-dsh-child` 组合会通过各进程选定的 filesystem Provider 安装工作区指令。`native-sdk-dsh-child` profile 使用 CLI 私有的固定 launcher 启动同版本 `native-sdk` profile；显式选择的 `dsh-sdk` child 会根据请求中的 cwd 独立发现项目指令，并使用自己的私有 DSH_HOME。

Native profile 可选择启用 `dsh-sdk` 或 `dsh-acp-child` 外部驱动。CLI 为各驱动提供同版本固定 launcher，并从最近可见的 pi-ai Provider 解析路由目录；ACP launcher 不接受调用方选择的可执行文件或任意 argv，子 profile 也不能再启动 child。这些适配器仍需在 profile 中显式安装，随附的 `native-sdk` 与 `native-acp` profile 不会选择它们。


## 应用参数

启动器只解析自身的 flag，并将其后的所有内容交给已启动的 legacy profile；注入该 profile 的任意应用插件都可以解析这份共享的不可变快照（[`dsh-cmdline`](../../Compatibility/DSH/boot/cmdline/README.zh.md)）。启动器无法识别的第一个 token 标志着应用参数的开始。新建的标准 `web` profile 会选择 Native Web，并拒绝 `--host`、`--port` 和 `--no-open`；名称为 `web` 的既有 legacy manifest 会保留其组合包解析器：

```sh
dsh --profile legacy-web --from-default-profile web --port 8080 # create and run legacy Web
dsh --profile legacy-web --port 8080 # --port belongs to the legacy web app
dsh --profile tui --resume <id>     # example, assuming the tui profile is installed; --resume belongs to the terminal app
dsh --profile headless "run the tests"
dsh --profile rsh --resume <id>     # --resume belongs to the RedSpark terminal app
dsh --profile legacy-web --help     # the legacy web app's flags, not the launcher's
dsh --help                          # the launcher's own help
```

<a id="profiles"></a>
## Profile

legacy profile 目录包含一个 `package.json`，其中记录树外插件依赖，以及 profile manifest（元数据清单）`dsh.profile`、其中按顺序排列的 `bundles` 列表与 `patchReload` 生命周期；还包含一个 `cordis.patch.yml`，其中保存用户自己的 patch 层。Native profile 会在包清单中声明 `runtime: "native"` 与 `config: "rsh.profile.json"`，并将安装项保存在带版本的 JSON 中。`package.json` 决定 runtime：显式 Native 标记会选择 Native；`runtime: "legacy"` 或不带 Native 字段的 legacy 组合包列表会选择 Cordis。`patchReload: live` 监视 legacy patch 文件，`startup` 则只应用一次。

`./native-profile` 库导出让私有 Desktop Host 复用经过校验的 profile 解析、preset 展开、child 路由派生与安装规划。它接受显式安装 profile 目录及可选的允许包根目录，不提供应用启动器或 argv API。随附 profile 名称来自 CLI 包导出的 `./package.json`，由该 manifest 单一维护。

选择随附 `native-*` 或标准 profile 名称会在首次使用时创建 Native profile 文件；已有 profile 保留其配置。

随附的 `native-web` profile 会为 Native Session API 安装 `standard` 和 `minimal` agent mode、plan-mode Provider，以及 `workspace-write` 和 `danger-full-access` 常驻权限 preset。

普通 `native-headless` 模板也会在首次初始化时把启动目录记录为应用工作区根目录。显式选择 `native-headless-query` 可安装组合式 SQLite 会话查询 Provider 与五个具备工作区授权的 Native 工具。该 profile 首次初始化时会把启动目录记录为应用工作区根目录。索引存于 `$DSH_HOME/sessions/query.sqlite`，并在首次搜索时打开；编辑 `session-query` 安装项可更改路径，或设置 `openAt: "never"`，同时保留精确读取能力。

随附的两个 headless 模板都含有禁用的 `tmux-context` 安装项。通过 profile overlay 启用它，并组合一个 `shell` Provider，即可将当前 pane 位置作为持久模型上下文；[Native tmux 上下文 README](../../Modules/Official/terminal/native-tmux-context/README.zh.md) 说明所需条件与消息格式。

原生 profile 在包清单中声明 `dsh.profile.runtime: "native"` 及 `config: "rsh.profile.json"`。带版本号的 JSON 文件列出作用域标识和插件安装项；每项包含 id、包名、作用域及完整配置。原生 `--patch` 文件是带版本号的 JSON 覆盖层，按参数顺序替换既有安装项的 config 或 `disabled` 值。每个选中的包清单都必须声明非空 npm `name` 和 `version` 字段；启动器在导入入口前校验其 `dsh.native` 元数据，拒绝非空 Cordis patch 层，并启动一个选中的原生应用。可用的一次性应用见[原生 headless](../../Engine/core/native-headless/README.zh.md)。

已存在的 profile manifest 仅在声明 `runtime: "legacy"` 或声明不带 native 配置字段的 `bundles` 数组时选择 legacy 执行。CLI native 启动会检查已安装插件对应的 legacy-only settings 与启动变量，把受支持的 settings 写入 native profile 文件，并在加载插件前安装启动代理。可接受值与报错见[原生配置迁移参考](../../Docs/native-config-migration.zh.md)。

CLI 的原生启动器直接依赖原生运行时。Cordis、profile 启动、配置转储和 profile 包管理依赖属于可选包；普通安装会包含它们，纯原生部署则可省略可选依赖。此时启动旧 profile 或调用仅供兼容层使用的 CLI 模式，会在导入 Cordis 前提示所需的安装方式。原生插件仍由选中的 profile 自行声明为依赖。

标准名称 `headless`、`web`、`sdk`、`acp` 和 `rsh` 在目录中没有 `package.json` 时会创建 Native profile；runtime resolver 继续为已有 manifest 选择运行时。`sdk-minimal` 仍是 legacy 组合包 profile。原生 Session 执行 Provider 提供选定的执行注册表与活动 Session 所有者，CLI 解析器将该 Provider 声明为直接依赖。

Host 配置在导入插件前捕获继承环境、调用目录与 Harness 主目录环境层。兼容启动共用同一验证加载器；每个根作用域拥有真实启动快照 Provider。每个 Host 根作用域还会获得 `pluginInventory` Provider，列出运行中 Host 的安装状态；重载后仍读取被保留的 Host。仅 Client 的配置两者都不安装。

配置树以空根为起点，依次叠加以下配置层：
- `dsh.profile.bundles` 中各组合包的 patch
- profile 自身的 `cordis.patch.yml`，然后是 home 级的 `$DSH_HOME/cordis.patch.yml`
- `--patch` 指定的覆盖层

`dsh.profile.bundles` 中列出的组合包先从 dsh 安装目录解析（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-rsh`、`@deepseek-ai/dsh-headless`、`@deepseek-ai/dsh-sdk-app`、`@deepseek-ai/dsh-sdk-minimal`、`@deepseek-ai/dsh-acp-app`），再从 profile 自身的 `node_modules` 解析；pnpm 会将树外插件安装到该目录。

对 legacy profile 使用 `--dump-default-config` 检查组合包默认值；当所选 profile 实际解析为 Native runtime 时会拒绝该选项，因此标准名称下已有的 legacy manifest 仍可使用。`--from-default-profile` 要求目标名称不是随附 profile 名称。Native `--dump-config` 会在不启动的情况下打印解析后的 Native JSON profile。

层的确切优先级、flag、关闭行为、部署默认值和源码执行方式，以 [CLI 行为参考](reference/README.zh.md)为准。

## 可选覆盖层

`config/examples/` 交付 GitHub 评审 webhook、会话内 Schedule、记忆 MCP 服务器与运行时 Cordis 工具的可选覆盖层。它们绝不属于默认 profile；设置与安全说明由[用户指南](../../Docs/user/guide/index.zh.md)和[开发实战指南](../../Docs/user/develop/practice/index.zh.md)负责。

## 开发

当 `DSH_EXAMPLE_MODE=lib` 时，[构建入口测试](tests/built-bin.e2e.ts)要求存在 `lib/bin.js`；入口缺失会失败，而不是跳过整组测试。已发布 native-headless profile 的 loader 检查也要求已构建的 native plugin 入口，请在运行该测试前执行 `pnpm run build`。未显式选择构建模式时，尚未构建的工作区可以跳过这些测试。

生产运行需要已构建的包与前端产物。请在仓库根目录单独运行 `pnpm run build`，然后使用 `pnpm dsh <args...>` 运行 TypeScript 入口并转发所有参数；模块解析约定以[源码执行参考](reference/README.zh.md#source-execution)为准。
