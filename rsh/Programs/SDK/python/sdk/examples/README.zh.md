# Python SDK 示例

[English](README.md) | 中文

基于唯一应用启动器 `dsh --profile sdk` 的可运行 Python SDK 示例。Python 客户端负责 JSON-RPC stdio；profile 负责 agent（智能体）组合、持久化、执行策略与插件。

## 运行示例

安装 `redspark-harness-sdk`、导出模型凭据，然后提供隔离的 Harness home 与 workspace：

```sh
export DEEPSEEK_API_KEY=sk-your-key-here
python rsh/Programs/SDK/python/sdk/examples/minimal.py \
  --dsh-home /absolute/path/to/example-dsh-home \
  --workspace /absolute/path/to/disposable-workspace \
  --session-id example-001 \
  "Inspect the repository and fix the failing tests."
```

如需使用兼容代理，请设置 `DEEPSEEK_BASE_URL`；可通过 `RSH_MODEL` 设置脚本的默认模型，通过 `RSH_SYSTEM_PROMPT` 指定部署角色设定。`--model` 是唯一运行时模型选择，不要求匹配的环境变量；`--profile` 可以选择另一个提供 SDK 服务的 profile。所选 home 保存初始化后的 `sdk` profile，并在 `sessions/` 下保存未压缩 JSONL 会话日志；脚本绝不会隐式读取 `~/.dsh`。

`sdk` 初始化为 native-sdk 组合。它包含按平台选择的持久 shell 与本地文件系统提供方，并固定 `danger-full-access`。请在一次性 checkout 或容器中使用。启动器拒绝 profile 名称 `sdk-minimal`。见 [Python SDK 教程](../../../../../Docs/user/guide/python-sdk.zh.md) 与[原生配置迁移](../../../../../Docs/native-config-migration.zh.md)。

## 添加插件

用 pnpm 把包安装进同一个显式 home 的 `sdk` profile 目录，再在该 profile 的 `rsh.profile.json` 中添加一条指明该包的 installation 记录：

```sh
export RSH_HOME=/absolute/path/to/example-dsh-home
cd "$RSH_HOME/profiles/sdk"
pnpm add file:/absolute/path/to/my-plugin-bundle
```

该插件必须发布 Native 入口并在 `dsh.native` 中声明它；参见[打包并安装 Native 插件](../../../../../Docs/user/develop/basic/publish.zh.md)。所选 profile 必须保留 JSON-RPC server 配置项。该示例不接受完整配置文件或任意进程 argv。运行时 wheel 包携带供单独使用的 CLI；图形界面的主要客户端是 Desktop。

另见 [Python SDK 教程](../../../../../Docs/user/guide/python-sdk.zh.md) 与 [SDK 参考](../README.zh.md)。
