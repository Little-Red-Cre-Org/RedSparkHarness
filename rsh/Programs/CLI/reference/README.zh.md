# `dsh` CLI（命令行界面）行为参考

[English](README.md) | 中文

本参考定义 profile 启动、web 别名、patch 与配置 dump 等命令模式。argv 由 [`src/args.ts`](../src/args.ts) 统一解析一次，[`src/bin.ts`](../src/bin.ts) 只会动态导入选中的运行器。

<a id="profile-boot"></a>

## Profile 启动

`dsh --profile <name>` 启动位于 `$RSH_HOME/profiles/<name>` 的 Native profile。启动器解析 profile manifest 的 Native runtime 标记与 `rsh.profile.json`，按 argv 顺序应用各个 `--patch <path>` 覆盖层，并启动唯一选定的应用。带 `plugin` 的行会向既有 scope 插入安装项；不带 `plugin` 的行替换既有安装项的字段，且存在的 `config` 会替换整个旧值而不是合并键。profile 自身的 `dsh.profile.configReload` 选择 `live` 文件监视或 `startup` 单次加载。配置解析、schema 校验、模块解析、包或插件启动失败时，系统会报告错误并以非零状态退出。收到 SIGINT 或 SIGTERM 时，挂载的根节点会先 dispose（资源释放）再退出。

标准名称 `headless`、`web`、`sdk`、`acp` 和 `rsh` 首次使用时会初始化对应 Native 组合：`native-headless`、`native-web`、`native-sdk`、`native-acp` 和 `native-tui`。profile 目录仍使用请求中的名称，包括 Web 项目与 scheduler 数据库路径。八个 `native-*` 名称仍可显式选择。启动器在启动、导出配置和 `--from-default-profile` 上拒绝 profile 名 `sdk-minimal`；请改用 `--profile sdk`。已有目录不会被改写。未声明 Native 执行的 manifest 会被拒绝，并提示查阅[原生配置迁移参考](../../../Docs/native-config-migration.zh.md)；启动器不再组合 Cordis profile。

profile 包必须声明非空 npm `name` 与 `version` 字段以及有效的 `dsh.native` 元数据。启动器在导入入口前按 profile 声明的 scope 校验每个选中安装项的包名。非空的 Cordis patch 层会被拒绝，而不会应用。

### Native profile 重载

随附的 `native-web` profile 设置 `dsh.profile.configReload: live`；它监视该 profile 的 `rsh.profile.json` 和通过 `--patch` 显式传入的 JSON 文件。CLI 会先校验候选组合，再替换正在运行的 Native Host；未变的安装身份会复用，受影响的应用运行会排空，然后从当前代际启动应用。格式错误或无法解析的候选会保留当前运行图。独立的应用故障即使与候选预检重叠，也会保留原诊断并终止进程；只有 invocation 自身完全匹配的 abort reason，或替换期间在应用回调开始前发生的 Host admission 拒绝，才会被视为运行代际已替换。Host 激活、清理或 watcher 失败会终止进程，不会复活旧运行图。`native-headless`、`native-sdk`、`native-acp` 和 `native-tui` profile 仍只在启动时加载。此机制监视 profile 数据，不监视包源码；Web Client 资源重建是另一条独立路径。

原生 profile runtime 标记以及 CLI 对 settings 和环境变量的迁移规则见[原生配置迁移参考](../../../Docs/native-config-migration.zh.md)。Native 启动会在加载 profile 插件前安装配置的全局代理，并在 Host 关闭后释放它。

### 模板初始化

`dsh --profile <name> --from-default-profile <template>` 会显式从随附 Native 模板之一创建新的 profile：五个标准别名或八个 `native-*` 名称之一。名称 `sdk-minimal` 会在启动前被拒绝。请使用 `rescue` 这类自定义目标名称；目标不能使用随附 profile 名称，且其完整目录必须不存在或为空。launcher 会以独占方式领取该目录，因此残留文件和另一个并发创建者都会在不作修改的情况下被拒绝。它写入该模板针对当前平台生成的 Native 组合，并在 `native-web` 时写入 `rsh.client.json`。目标名称会记录为 profile 名称；模板列表之后的变化不会改写新 profile。

profile 已经存在时，`--from-default-profile` 会被拒绝，且不会修改或启动它；去掉该选项即可使用它。残留的目标目录同样会被原样保留，此时必须改用另一个 profile 名称。未知模板或随附目标名称会在创建目标之前失败；未知模板的诊断会列出有效模板。初始化在组合包解析和应用启动之前提交，因此后续失败仍会把新 profile 留在磁盘上，重试时需要去掉创建选项。`--dump-config` 接受该选项，初始化目标并打印所请求的配置树，但不启动应用。

```sh
dsh --profile rescue --from-default-profile web
dsh --profile rescue
```

## 应用参数

启动器的 flag 位于最前，并在第一个无法识别的 token 处结束；此后所有内容都会原样交给已启动的应用。Native Web 没有应用参数解析器，并拒绝 `--host`、`--port` 和 `--no-open`。启动器 flag 必须位于应用参数之前，且启动器会消费一个 `--`：需要以字面量 `--` 到达应用的参数必须写成 `-- --`。第一个应用参数若等于 `web`，则会选择别名。

随附应用各自拥有以下命令行：

| Profile | 参数 |
|---|---|
| `web` | web 应用自己的 flag；`--host`、`--port` 与 `--no-open` 会被拒绝 |
| `headless` | 任务文本，作为位置参数 |
| `sdk`、`native-sdk` | 无选项；stdio 承载 JSON-RPC 协议 |
| `acp`、`native-acp` | 无选项；stdio 承载 ACP（Agent Client Protocol） |
| `rsh` | 终端应用的 flag，例如 `--resume <id>` |
| `sdk-minimal` | 已拒绝。请改用 `--profile sdk`。 |

一次性任务（`dsh --profile headless "run the tests"`）会通过核心 registry 创建一个全新的持久化 Agent，提交任务，等待静默，并在 flush Session 后从其持久区间推导最后一条非空 assistant 文本和最终 `turn/end` 原因。它把非空的提供者 reasoning 增量以 `dsh: reasoning:` 标题写入 stderr，只在 stdout 打印最终文本；`completed` 时退出码为 0，否则为 1；成功响应且无 reasoning 时 stderr 为空。没有任务文本的调用是该应用的用法错误。随附 headless profile 不挂载浏览器 Connection、HTTP 服务器、Web 运行时或浏览器客户端，也不打开监听端口。

## 配置 dump

`--dump-config` 打印解析后的 Native profile JSON，包含 profile 自身层与每个 `--patch` 覆盖层，但不启动它。dump 会初始化缺失的 profile 文件，但不会准备 `$RSH_HOME/profiles/node_modules` 下的运行时模块后备目录。它从不运行应用命令行 Provider，因此会拒绝携带应用参数的调用。

```sh
dsh --profile rescue --from-default-profile web --dump-config
dsh --profile rescue --patch ./extra.json --dump-config
```

## Web 别名

`dsh web` 是 `--profile web` 的硬编码别名。

```sh
dsh web
dsh web --dump-config
dsh web --help
```

Native Web 应用需要已构建的包与前端产物（`pnpm run build`）。它默认服务 `http://127.0.0.1:3080`，并在本地启动时等待完整 Host 树稳定后才打开规范主机 URL。继承的 `SSH_CONNECTION` 或 `SSH_TTY` 非空时会抑制浏览器交接，因为 SSH 客户端或编辑器持有本地转发地址；主机 URL 仍会打印。端口、可信主机与浏览器交接等部署取值属于 profile 配置，不是启动器 flag。legacy 兼容应用在本地交接前会打印 `dsh web: opening the default browser; pass --no-open to disable`；Native Web 应用不接受该 flag。

进程关闭会为插件树留出最多五秒的 dispose 时间。首个 `SIGINT`/`SIGTERM` 启动该优雅排空——`SIGTERM` 是监管进程的普通停止请求，在所有表层都退出 0；`SIGINT` 报告 130；第二次信号会强制立即退出。若一次性任务的正常完成已卡在释放阶段，首个 `Ctrl+C` 就是升级信号，会立即退出而不会被吞掉。

Native profile 把调用目录视为默认 workspace 根目录，加载适用的 `AGENTS.md` 或 `CLAUDE.md` 指令并使用 65,536 字节渲染预算，同时使用已安装的会话内容索引。`native-sdk` 还安装已退役 `sdk-minimal` profile 提供的持久 shell 行，并固定为 `danger-full-access`，因此 SDK 客户端仍能获得 shell，但不含文件系统工具或指令发现。

以 base 为基础的 profile 中，新 Session 默认使用 `workspace-write` 权限 preset。Bash 与文件系统变更限制在会话 workspace 与平台临时根目录内；读取和网络访问不受限制，而进程可见性取决于所选沙箱后端：bwrap 在私有 PID 命名空间中运行命令并隐藏宿主进程，Landlock 与 Seatbelt 则不改变宿主进程可见性。`RSH_PERMISSION_MODE` 改变进程级后备值。已存储的 General settings 权限只影响之后的 Web 会话，不影响已打开的会话。

`RSH_TOOLS_MODE` 为进程选择 `native`、`ptc` 或 `both`；其他值会在启动时失败。随附的 `minimal` agent preset 保留该部署呈现，把完整系统提示固定为 `You are a helpful software engineer assistant.`，并且只组合平台选定的持久 shell。创建 Web 会话时选择极简模式；该 agent 中其他提示段与面向模型的插件都缺席，而共享的浏览器、workspace、持久化、沙箱与权限 Host 保持不变。

## 共享部署行为

Native profile 通过显式安装项挂载各自的模型适配器、设置与凭据 Provider、搜索与抓取工具、遥测以及会话日志贡献者。提供者凭据依次从继承环境、`$RSH_HOME/.credentials.yaml`、调用目录的 `.env`、`$RSH_HOME/.env` 解析；受管文档绝不会写入 `process.env`，而两个 `.env` 文件都是普通启动环境层。搜索使用 `DEEPSEEK_API_KEY`，并接受 `DEEPSEEK_SEARCH_BASE_URL`。已启用的抓取调用在所有沙箱与审批模式下执行，无需逐次确认；Provider 会在连接前拒绝非公开目的地。

反馈会记录到 Session 日志，不启动模型工作。启用 [DeepSeek 会话日志贡献者](../../../Modules/Official/llm/session-log-deepseek/README.zh.md)后，后续 DeepSeek 请求会发送完整且未被接受的日志后缀，包括经配置网关发送的请求。[OTel 会话上传](../../../Engine/session/session-telemetry-otel/README.zh.md)适用于所有用户和提供者，包括 `deepseek-official`，且不需要请求头。默认的 `FEEDBACK_ONLY` 模式会在新的本人文本反馈、消息评分、编辑与撤回时释放完整规范前缀，包括已存储上下文；之后的记录会等待下一次显式反馈。继承的父级反馈不授权分叉。请求、恢复、挂载与 HMR 都不会触发采集。SDK 批处理可以在没有进一步交互或模型工作的情况下完成已授权上传。`RSH_TELEMETRY_MODE=DISABLED` 关闭 OTel 投递；`FULL` 会被拒绝，任何非空 `RSH_TELEMETRY_DISABLED` 都会禁用对应行。`RSH_TELEMETRY_OTLP_URL` 选择 collector。交接是尽力而为，不代表 collector 已接受；不提供持久 outbox 或重试保证。这些 OTel 设置不会启用或禁用 DeepSeek 贡献者。两条路径都不改变模型输入，但导出内容可能包含消息文本、工具参数与结果以及工作区路径。

外部插件以 `rsh.profile.json` 安装项加入，或通过贡献自身安装行的 Native 覆盖包加入。CLI 还随附 `@redspark/rsh-mcp-client` 作为依赖，但默认不启用任何 MCP 服务器，因为每个服务器命令都是 agent 沙箱之外的可信可执行代码。

<a id="source-execution"></a>
## 源码执行

在仓库根目录，全新 checkout 后以及产物需要更新时，先单独运行 `pnpm run build`，再使用 `pnpm dsh <args...>`。`package.json` 脚本通过 `node --import tsx/esm` 启动 `rsh/Programs/CLI/src/bin.ts`，不构建并转发所有参数。TypeScript SDK 源码启动器只提供 `tsx/esm` 与其 tsconfig。缺失的 Typert host 产物会通过模块解析错误使 profile 启动失败，且不会给出构建提示。这些 host 产物存在后，缺失的前端或 client-plugin 组合会在启动时失败，并提示运行 `pnpm run build`。启动器不检查新鲜度，因此过期的既有组合可能继续运行较旧的浏览器代码，直至重新构建。进程继承启动环境，且 `runProfile` 在任何入口挂载前从该快照解析出站代理，因此 `HTTP_PROXY`/`HTTPS_PROXY`（以及 `.env` 层中声明的代理）无需额外 flag 即可生效。安装形态直接启动构建后的 `rsh/Programs/CLI/lib/bin.js`，不重新构建仓库。
