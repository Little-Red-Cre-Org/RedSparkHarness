# Agent Note: Darwin Seatbelt 的 realpath 与单元步骤前的构建

Status: implemented

[English](2026-11-22-darwin-seatbelt-realpath-and-build.md) | 中文

## 问题

在 darwin 上，`os.tmpdir()` 把一个目录写成 `/var/folders/...`，而 `realpath` 把同一目录写成 `/private/var/folders/...`。`relative` 与前缀检查把这两种拼写当成互不相关的目录。

`rsh/Scripts/coalesce-staged-dsh-tools.ts` 用 `resolve` 得到的暂存根目录，去比较 ESM 解析已经做过 `realpath` 的包目录。`packageDirectoryForUrl` 随后报告该暂存包在暂存根目录之下没有包目录。同一处分裂进入 Vite：`collectShell` 把未做 `realpath` 的 shell 根目录传给 `vite.build`，而 Vite 会对输入和 alias 目标做 `realpath`。

`rsh/Programs/Desktop/src/main.ts` 在模块加载时调用 `app.setPath('userData', desktopUserDataPath())`。桌面启动 spec 的 paths mock 只导出 `resolveDesktopPaths`，其假 `app` 有 `getPath` 而没有 `setPath`，因此 import 在任何用例运行前抛出。

`.github/workflows/sandbox.yml` 只在 seatbelt 这一路上运行单元测试套件。`pnpm test` 是 `pnpm run build:native-system && vitest run`，不会产出被 gitignore 的 `lib/`。对该 `lib/types` 的 import 在这个 runner 上失败。该 job 的 20 分钟预算盖不住安装、一次仓库构建、完整单元测试套件，以及两个文件的内核 e2e。

## 决策

`resolveDirectory` 对已存在的路径使用 `realpathSync.native`，对 `ENOENT` 与 `ENOTDIR` 保留 `resolve` 的拼写。Windows 的小写化仍在其后进行。`isWithin` 比较这些拼写，因此暂存根目录与解析出的包共享同一个前缀。不同的目录仍然不同。

`collectShell` 在调用 `browserSourceAliases` 之前对仓库根目录做 `realpath`，对传给 `vite.build` 的 shell 根目录做 `realpath`，并在把相对输入相对该 shell 根目录解析之后，对每个已存在的输入做 `realpath`。已存在且不含 `$` 的绝对 alias `replacement` 会做 `realpath`。`loadConfigFromFile` 收到的仍是它加载时使用的配置目录。

桌面启动 spec 的 paths mock 导出 `desktopUserDataPath: () => 'desktop-test-user-data'`，且不调用 `resolveRshHome`。假 `app` 提供 `setPath: vi.fn()`。`main.ts` 与 `paths.ts` 不变。

当 `matrix.runner == 'seatbelt'` 时，sandbox 工作流在 `pnpm run test` 之前立即运行 `pnpm run build`。bwrap 与 landlock 不这样做。`test` 脚本不变。该 job 的 `timeout-minutes` 为 60。job 与单元步骤都不设置 `continue-on-error`，该步骤也不收窄或跳过文件。`rsh/Scripts/ci-workflow.spec.ts` 断言这一顺序、不存在 `continue-on-error`，以及 60 分钟预算。

## 考虑过的替代方案

**只对一侧做 realpath。** 拒绝：ESM 解析与 Vite 已经对一侧做了 realpath，另一侧留在 `/var` 时前缀检查仍然失败。

**把断言改写成 `/var` 拼写。** 拒绝：两种拼写指的是同一个目录。在断言里记录 `/var` 会保留这一不一致，而不是比较探针已经解析出的目录。

**删除或跳过 TUI 或 Typert。** 拒绝：二者都属于 seatbelt 这一路要运行的单元测试套件。跳过它们会让这些 import 不被执行。

**把 `pnpm run build` 折进每个操作系统的 `pnpm test`。** 拒绝：`pnpm test` 保持为 `pnpm run build:native-system && vitest run`。其他单元 lane 已经从自己的构建步骤得到 `lib/`，把构建放进每一次 `pnpm test` 会重复这项工作。

**在单元步骤上设置 `continue-on-error`。** 拒绝：失败的单元测试套件必须让 seatbelt job 失败。内核 e2e 仍排在该结果之后。超时是失败，不是跳过。

## 后果

暂存工具合并与浏览器 shell 遍历中的 darwin 前缀检查比较同一种目录拼写，桌面启动 spec 可以加载 `main.ts`。seatbelt job 用 60 分钟预算完成一次真实的 `lib/` 构建、完整单元测试套件，以及两个文件的内核 e2e。

路径拼写、桌面启动 mock，以及这次 `lib/` 构建，是本决策关闭的缺陷。其他单元失败仍留在套件中。e2e 步骤没有 `continue-on-error`，并且 `pnpm test` 仍然不产出 `lib/`。
