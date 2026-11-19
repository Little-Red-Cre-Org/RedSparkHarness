# 打包并安装 Native 插件

[English](publish.md) | 中文

前面的教程通过 profile 组合挂载了本地插件。本教程把该插件打包为带 Native 入口的 npm 包，安装进 profile，并说明 profile JSON 如何指名它。本教程假定已安装 `dsh` CLI。请先完成[插件配置](./config.zh.md)。

如果想改用全新的源码 checkout，请把本教程的 `hello-plugin` 目录留在仓库根目录，并从那里以 `pnpm ...` 运行后续命令。构建与启动行为见[源码执行](../../../../Programs/CLI/reference/README.zh.md#source-execution)。

## 包 manifest

Native 插件是普通的 ESM 包：它发布名为 `plugin` 的导出，并在 `dsh.native` 下声明协议元数据：

```
hello-plugin/
├── package.json
└── index.js
```

创建 `hello-plugin/package.json`：

```json
{
  "name": "dsh-hello-plugin",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./index.js" },
  "dsh": {
    "native": {
      "apiVersion": 1,
      "entry": ".",
      "targets": ["host"],
      "requires": [],
      "optional": [],
      "provides": []
    }
  }
}
```

`entry` 必须指向已发布的 `exports` 子路径。`targets` 选择 `host`、`client` 或两者。`requires` 列出必须已有 Provider 的服务，`optional` 列出存在时才会使用的服务，`provides` 列出本插件注册的服务键。启动器会在导入入口前校验这些元数据。

## 插件入口

创建 `hello-plugin/index.js`：

```js
export const plugin = {
  apiVersion: 1,
  name: 'hello-plugin',
  targets: ['host'],
  requires: [],
  provides: [],
  resolve(config) {
    return (ctx) => {
      console.log('[hello-plugin] plugin loaded!', config)
    }
  },
}
```

`resolve(config)` 校验安装项的配置并返回激活函数；它本身不得激活资源。运行时以安装项的 scope context 调用该激活函数，并在 profile 停止时释放其资源。每个导出字段都必须与 `dsh.native` 一致；不一致会在激活前失败。

注册服务的插件在 `provides` 中声明同一个键，并在激活函数中调用 `ctx.provide(key, value)`。scope context 的 `signal` 会在关闭时中止，`own(disposer)` 用于登记释放逻辑。

## 安装进 profile

profile 是 `$RSH_HOME/profiles/<name>` 下带 `package.json` runtime 标记与 `rsh.profile.json` 组合的目录。先用 pnpm 把包安装到该目录：

```sh
cd "$RSH_HOME/profiles/demo"
pnpm add /path/to/hello-plugin
```

然后在 `rsh.profile.json` 中加入一条安装项：

```json
{
  "formatVersion": 1,
  "scopes": [{ "id": "root" }],
  "installations": [
    { "id": "hello", "plugin": "dsh-hello-plugin", "scope": "root" }
  ]
}
```

安装项的 `id` 在 profile 内唯一；`plugin` 必须等于已安装包名；`scope` 必须指名已声明的 scope。版本与 Native 入口来自包 manifest。缺失包、没有 version 的 manifest、非法的 `dsh.native` 声明，或没有 Provider 的服务需求，都会在应用启动前失败。

添加安装项时请保留随附组合的其余行：profile 只会启动该文件中的安装项。`--dump-config` 会打印解析后的组合而不启动应用：

```sh
dsh --profile demo --dump-config
dsh --profile demo
```

## 覆盖层

`--patch <file.json>` 会在 profile 自身文件之后按 argv 顺序应用版本化 JSON 覆盖层。不带 `plugin` 的行替换既有安装项的字段，存在的 `config` 会替换整个旧值而不是合并键。带 `plugin` 的行会向既有 scope 插入新安装项。可用覆盖层试验配置变更而无需编辑 profile：

```json
{
  "formatVersion": 1,
  "installations": [
    { "id": "hello", "config": { "greeting": "hi" } }
  ]
}
```

```sh
dsh --profile demo --patch ./hello-overlay.json
```

未知目标、重复 id 与未知 scope 都会被拒绝。`native-web` 的实时重载会按同一规则读取显式 JSON 覆盖层。

## 从 GitHub 安装

不必发布到 registry——在 profile 目录中执行 `pnpm add github:you/hello-plugin` 即可。git 安装获取的是源码而不是构建产物，因此 TypeScript 包需要一个 `prepare` 脚本，在不依赖同仓库 sibling checkout 的前提下构建已发布入口。pnpm ≥10 会拒绝运行该脚本，直至 profile 允许它：

```yaml
# $RSH_HOME/profiles/demo/pnpm-workspace.yaml
allowBuilds:
  dsh-hello-plugin: true
```

这一许可是允许该包在安装期于你的机器上执行代码，位于 agent 沙箱之外。请固定 commit（`github:you/hello-plugin#<sha>`），使后续 push 无法静默改变实际运行的代码。发布构建产物到 npm 或交付 tarball 则完全不需要构建许可。

## 下一步

- [插件与生命周期](../framework/index.zh.md)——Native 插件生命周期
- [CLI 行为参考](../../../../Programs/CLI/reference/README.zh.md)——profile 组合、patch 与 dump
