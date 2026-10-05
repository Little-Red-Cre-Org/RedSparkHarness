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
| `dsh --profile rsh` | 打开持久化 RedSpark 终端会话。 |
| `dsh --profile sdk` | 通过 JSON-RPC stdio 为 SDK 客户端提供服务，直至关闭或断开连接。 |
| `dsh --profile native-sdk` | 通过 JSON-RPC stdio 提供文本与图片 SDK 轮次、实时模型分块、Session 取消、下一步引导与已结束轮次分叉。 |
| `dsh --profile sdk-minimal` | 以独立极简 agent（智能体）配置树为 SDK 客户端提供服务。 |
| `dsh web` | `--profile web` 的别名。 |
| `dsh plugin --profile <name> <pnpm args>` | 通过在 profile 目录中转发给 pnpm 来管理该 profile 的插件。 |

运行命令时所在的目录将作为默认 workspace 根目录。`web`、`rsh`、`headless`、`sdk`、`sdk-minimal`、`acp` 和 `native-sdk` profile 在首次使用时会从随附模板自动初始化。使用 `--from-default-profile` 可以基于这些模板之一，在尚未使用的非内置名称处创建其他 profile；通过 `dsh plugin` 则可以初始化一个以 base 为基础的 profile。`desktop` 名称保留给 Electron 持有的 profile，因此 CLI（命令行界面）会拒绝针对它的启动、配置 dump 和插件管理请求。

## 应用参数

启动器只解析自身的 flag，并将其后的所有内容交给已启动的 profile；注入该 profile 的任意应用插件都可以解析这份共享的不可变快照（[`dsh-cmdline`](../../Compatibility/DSH/boot/cmdline/README.zh.md)）。启动器无法识别的第一个 token 标志着应用参数的开始：

```sh
dsh --profile web --port 8080       # --port belongs to the web app
dsh --profile tui --resume <id>     # example, assuming the tui profile is installed; --resume belongs to the terminal app
dsh --profile headless "run the tests"
dsh --profile rsh --resume <id>     # --resume belongs to the RedSpark terminal app
dsh --profile web --help            # the web app's flags, not the launcher's
dsh --help                          # the launcher's own help
```

<a id="profiles"></a>
## Profile

profile 目录包含一个 `package.json`，其中记录树外插件依赖，以及 profile manifest（元数据清单）`dsh.profile`、其中按顺序排列的 `bundles` 列表与 `patchReload` 生命周期；还包含一个 `cordis.patch.yml`，其中保存用户自己的 patch 层。`patchReload: live` 监视 profile 与 home 级 patch 文件，`startup` 则只应用一次。

`./native-profile` 库导出让私有 Desktop Host 复用经过校验的 profile 解析与安装规划。它接受显式安装 profile 目录及可选的允许包根目录，不提供应用启动器或 argv API。

选择内置 `native-*` profile 会在首次使用时创建原生 profile 文件；已有 profile 保留其配置。

原生 profile 在包清单中声明 `dsh.profile.runtime: "native"` 及 `config: "rsh.profile.json"`。带版本号的 JSON 文件列出作用域标识和插件安装项；每项包含 id、包名、作用域及完整配置。原生 `--patch` 文件是带版本号的 JSON 覆盖层，按参数顺序替换既有安装项的 config 或 `disabled` 值。启动器在导入入口前校验所有选中包的 `dsh.native` 元数据，拒绝非空 Cordis patch 层，并启动一个选中的原生应用。可用的一次性应用见[原生 headless](../../Engine/core/native-headless/README.zh.md)。

CLI 的原生启动器直接依赖原生运行时。Cordis、profile 启动、配置转储和 profile 包管理依赖属于可选包；普通安装会包含它们，纯原生部署则可省略可选依赖。此时启动旧 profile 或调用仅供兼容层使用的 CLI 模式，会在导入 Cordis 前提示所需的安装方式。原生插件仍由选中的 profile 自行声明为依赖。

Host 配置在导入插件前捕获继承环境、调用目录与 Harness 主目录环境层。兼容启动共用同一验证加载器；每个根作用域拥有真实启动快照 Provider。仅 Client 的配置不安装它。

配置树以空根为起点，依次叠加以下配置层：
- `dsh.profile.bundles` 中各组合包的 patch
- profile 自身的 `cordis.patch.yml`，然后是 home 级的 `$DSH_HOME/cordis.patch.yml`
- `--patch` 指定的覆盖层

`dsh.profile.bundles` 中列出的组合包先从 dsh 安装目录解析（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-rsh`、`@deepseek-ai/dsh-headless`、`@deepseek-ai/dsh-sdk-app`、`@deepseek-ai/dsh-sdk-minimal`、`@deepseek-ai/dsh-acp-app`），再从 profile 自身的 `node_modules` 解析；pnpm 会将树外插件安装到该目录。

使用 `--dump-default-config` 和 `--dump-config` 可在不启动的情况下检查组合后的配置树。

层的确切优先级、flag、关闭行为、部署默认值和源码执行方式，以 [CLI 行为参考](reference/README.zh.md)为准。

## 可选覆盖层

`config/examples/` 交付 GitHub 评审 webhook、会话内 Schedule、记忆 MCP 服务器与运行时 Cordis 工具的可选覆盖层。它们绝不属于默认 profile；设置与安全说明由[用户指南](../../Docs/user/guide/index.zh.md)和[开发实战指南](../../Docs/user/develop/practice/index.zh.md)负责。

## 开发

当 `DSH_EXAMPLE_MODE=lib` 时，[构建入口测试](tests/built-bin.e2e.ts)要求存在 `lib/bin.js`；入口缺失会失败，而不是跳过整组测试。未显式选择构建模式时，尚未构建的工作区可以跳过这些测试。

生产运行需要已构建的包与前端产物。请在仓库根目录单独运行 `pnpm run build`，然后使用 `pnpm dsh <args...>` 运行 TypeScript 入口并转发所有参数；模块解析约定以[源码执行参考](reference/README.zh.md#source-execution)为准。
