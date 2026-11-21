# `@redspark/rsh`

[English](README.md) | 中文

`dsh` 是唯一受支持的 Node 应用启动器。每个 profile 都从 `$RSH_HOME/profiles/<name>` 启动 Native 组合；SDK 与 ACP（Agent Client Protocol）都是 profile，而不是独立的公开可执行命令。Python 运行时 wheel 包中也包含同一个命令。Windows 上可选的 `rsh` Shell shim 会路由到源码中的 `dsh --profile rsh` 启动器，并不会引入第二个 Node 应用表层。[`src/args.ts`](src/args.ts) 负责命令语法，[`src/bin.ts`](src/bin.ts) 只加载选中的运行器。无效命令、来自其他模式的选项、配置错误和启动失败都会以非零状态退出。

## 入口模式

| 命令 | 用途 |
|---|---|
| `dsh --profile <name>` | 启动位于 `$RSH_HOME/profiles/<name>` 的指定 profile。 |
| `dsh --profile <name> --from-default-profile <template>` | 从随附模板创建新的自定义 profile，然后启动它。 |
| `dsh --profile acp` | 通过 ACP stdio 为自动化客户端提供服务，直至断开连接。 |
| `dsh --profile headless "job"` | 运行一个全新的持久化会话，打印最终答案并退出。 |
| `dsh --profile native-headless-query "job"` | 运行 Native headless Session，并启用授权范围限于工作区的既往会话查询工具。 |
| `dsh --profile rsh` | 打开持久化 RedSpark 终端会话。 |
| `dsh --profile sdk` | 通过 JSON-RPC stdio 为 SDK 客户端提供服务，直至关闭或断开连接。 |
| `dsh --profile native-sdk` | 通过 JSON-RPC stdio 提供文本与图片 SDK 轮次、实时模型分块、Session 取消、下一步引导与已结束轮次分叉。 |
| `dsh --profile native-acp` | 通过标准 ACP 标准输入输出驱动原生文本／图片 Session、模型配置、取消与持久恢复。 |
| `dsh --profile sdk-minimal` | 已拒绝。请改用 `dsh --profile sdk`。已有目录不会被改写。 |
| `dsh --profile web` | 已拒绝。浏览器部署入口已退役；请改用 `dsh --profile native-web`。 |

运行命令时所在的目录将作为默认 workspace 根目录。新建的 `headless`、`sdk`、`acp` 和 `rsh` profile 分别初始化为 `native-headless`、`native-sdk`、`native-acp` 和 `native-tui`，同时保留请求中的 profile 名称。八个 `native-*` 模板仍可显式选择。启动器在启动、导出配置和 `--from-default-profile` 上拒绝 `sdk-minimal` 与已退役的浏览器 `web` 名称；Native Web profile 请使用 `native-web`。已有 profile 会保留其文件，初始化不会改写它；未选择 Native 执行的 manifest 会被拒绝，并提示查阅[原生配置迁移](../../Docs/native-config-migration.zh.md)。`desktop` 名称保留给 Electron 持有的 profile，因此 CLI（命令行界面）会拒绝针对它的启动与配置 dump 请求。

`native-headless`、`native-headless-query`、`native-tui` 和 `native-web` 会话默认值使用随附 pi-ai 的 `deepseek` 路由和 `deepseek-flash` 模型。Native ACP 保留显式的 `deepseek-official` 路由。

native-sdk 配置还组合 native-tools、native-prompt、native-subagent、native-jobs 及其工具消费者。子执行使用相同的选定 Program 执行器、Session 存储与模型提供者。该 profile 提供可续接 Subagent 支持：`subagent` 启动持久子任务，`send_message` 发送后续工作，`interrupt_agent` 中断其当前回合。一次性后台子任务通过 `job_output`/`job_kill` 查看或停止。

`native-sdk`、`native-sdk-dsh-child`、`native-acp` 与 `native-acp-dsh-child` 组合会通过各进程选定的 filesystem Provider 安装工作区指令。`native-sdk-dsh-child` profile 使用 CLI 私有的固定 launcher 启动同版本 `native-sdk` profile；显式选择的 `dsh-sdk` child 会根据请求中的 cwd 独立发现项目指令，并使用自己的私有 RSH_HOME。

Native profile 可选择启用 `dsh-sdk` 或 `dsh-acp-child` 外部驱动。CLI 为各驱动提供同版本固定 launcher，并从最近可见的 pi-ai Provider 解析路由目录；ACP launcher 不接受调用方选择的可执行文件或任意 argv，子 profile 也不能再启动 child。这些适配器仍需在 profile 中显式安装，随附的 `native-sdk` 与 `native-acp` profile 不会选择它们。

## 应用参数

启动器只解析自身的 flag，并将其后的所有内容交给已启动的应用。启动器无法识别的第一个 token 标志着应用参数的开始：

```sh
dsh --profile native-web                   # Native Web, default flags only
dsh --profile headless "run the tests"
dsh --profile rsh --resume <id>            # --resume belongs to the terminal app
dsh --profile native-web --help            # the web app's flags, not the launcher's
dsh --help                                 # the launcher's own help
```

Native Web 拒绝 `--host`、`--port` 和 `--no-open`；部署取值应写入 profile 的 `rsh.client.json` 与 `rsh.profile.json`。

<a id="profiles"></a>
## Profile

Native profile 在其 package manifest 中声明 `dsh.profile.runtime: "native"` 和 `config: "rsh.profile.json"`。该版本化 JSON 文件列出 scope 身份与插件安装项，每项包含 id、包名、scope 与完整配置。`--patch` 文件是版本化 JSON 覆盖层，按参数顺序替换现有安装项的 config 或 `disabled` 值，或插入一个指名既有 scope 的安装项。启动器要求每个选中的 package manifest 声明非空 npm `name` 与 `version` 字段，在导入入口前校验其 `dsh.native` 元数据，拒绝非空的 Cordis patch 层，并只启动一个选定的原生应用。可用的一次性应用见 [native headless](../../Engine/core/native-headless/README.zh.md)。

`./native-profile` 库导出与私有 Desktop Host 共享经过校验的 profile 解析、preset 展开、子路由推导和安装规划。它接受显式的已安装 profile 目录和可选的允许包根目录；不暴露应用启动器或 argv API。随附 profile 名称来自 CLI 包的 `./package.json` 导出，使该 manifest 保持为单一来源。

选择随附的 Native profile 名称会在首次使用时创建其 Native profile 文件；已有 profile 保留其配置。`--from-default-profile` 会把随附模板复制为新的自定义名称：

```sh
dsh --profile rescue --from-default-profile native-web
dsh --profile rescue
```

目标名称不得是随附 profile 名称，其目录必须为空或不存在。复制或启动失败会把已创建的 profile 留在磁盘上，因此重试时应去掉创建选项。未知模板的诊断会列出所有可接受模板；`--dump-config` 接受该选项，打印复制出的组合但不启动它。

随附的 `native-web` profile 为其 Native Session API 安装 `standard` 与 `minimal` 两种 agent 模式、plan-mode Provider，以及常驻权限 preset `workspace-write` 与 `danger-full-access`。

普通的 `native-headless` 模板还会在首次初始化时记录调用目录为应用 workspace 根目录。需要显式选择 `native-headless-query` 才会安装组合式 SQLite 会话查询 Provider 与五个 Native 工作区授权工具。首次初始化时，该 profile 会记录调用目录为应用 workspace 根目录。它把索引存放在 `$RSH_HOME/sessions/query.sqlite`，并在首次搜索时打开；可编辑其 `session-query` 安装项来改变路径，或设置 `openAt: "never"` 以保留精确读取。

两个随附 headless 模板都包含一个禁用的 `tmux-context` 安装项。通过 profile 覆盖层启用它并组合 `shell` Provider，即可把当前窗格位置加入持久模型上下文；[Native tmux-context README](../../Modules/Official/terminal/native-tmux-context/README.zh.md) 说明其要求与消息。

Native 启动会检查已安装插件的 legacy 专用设置与启动变量，把受支持的设置复制进 Native profile 文件，并在加载插件前安装启动代理。接受的值与错误见[原生配置迁移参考](../../Docs/native-config-migration.zh.md)。

Host profile 会在导入插件前捕获继承环境、调用目录与 Harness home 三层。每个 Host 根 scope 都拥有真实的启动快照 Provider，以及列出运行中 Host 安装状态的 `pluginInventory` Provider。只有 Client 的 profile 两者都不安装。

## 可选覆盖层

`config/examples/` 提供 GitHub 评审 webhook、会话内 Schedule 与记忆 MCP 服务器的可选 Cordis 覆盖层，供 Web 应用测试与 legacy 组合使用。它们绝不属于默认 Native profile；设置与安全说明由[用户指南](../../Docs/user/guide/index.zh.md)负责。Native profile 以 `rsh.profile.json` 安装项表达相同能力。

## 开发

[构建入口测试](tests/built-bin.e2e.ts)在 `RSH_EXAMPLE_MODE=lib` 时要求 `lib/bin.js`；缺失入口会失败而不是跳过测试套件。随附 native-headless loader 检查同样要求已构建的原生插件入口。请在 `pnpm run build` 之后运行；未构建的 checkout 在显式构建模式之外可能跳过这些测试。

生产运行需要已构建的包与前端产物。在仓库根目录先单独运行 `pnpm run build`，再用 `pnpm dsh <args...>` 运行 TypeScript 入口并转发所有参数；模块解析约定由[源码执行参考](reference/README.zh.md#source-execution)负责。
