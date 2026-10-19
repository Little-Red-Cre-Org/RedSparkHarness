# Agent Note: Desktop Host 自行关闭它的描述符，prune 保留内容不一致的嵌套副本

Status: implemented

[English](2026-10-19-desktop-host-teardown-and-nested-prune.md) | 中文

## Problem

两个缺陷共有一个成因：收尾代码断言了一件操作系统已经在做的事。

Desktop Host 从 Electron 继承描述符 3 和 4，并用 `fs` 流包装它们。只要 `autoClose` 保持默认值，Node 的 `fs` 流就拥有这个继承来的描述符：`destroy()` 关闭读端，写端在最后一次写入排空后自行关闭。`runDesktopHost` 的停止路径却在 `destroy()` 之后又调用 `closeSync(DESKTOP_REQUEST_PIPE_FD)` 和 `closeSync(DESKTOP_RESPONSE_PIPE_FD)`。第二次关闭与流自身延迟的关闭发生竞争而失败，报出 `EBADF`。Host 把流错误交给 `failTransport`，于是一次干净的关闭会打印传输失败，并把 `Desktop Host stderr` 写进桌面日志：

```
Error: EBADF: bad file descriptor, close
Emitted 'error' event on WriteStream instance
```

父进程侧，`DesktopHostProcess.stop()` 请求收尾后等待。子进程退出会关闭响应管道，`'end'` 监听器随即通过 `onFailure` 报出 `dsh desktop host response pipe ended`。这让一次有意的、成功的停止与一次崩溃的 Host 无法区分，而这正是运维在每次插件变更时读到的、被当成缺陷的那条消息。

Python runtime 的 prune 有一个镜像问题。`pruneNestedNodeModules` 删除保留包下每一个嵌套 `node_modules`，理由是保留包会从暂存根解析它的同伴。但 Node 解析 `<package>/node_modules/<dep>` 的优先级高于暂存根，所以嵌套副本才是运行时实际导入的那一个。删除一份不一致的副本会静默改变打包后可执行文件加载的模块，而故障要到启动时才以缺失模块或错误版本的形式暴露。当前依赖集恰好不含嵌套目录，这正是该缺陷从未触发的原因。

## Decision

每个描述符恰好有一个所有者。

`rsh/Programs/DesktopHost/src/pipes.ts` 中的 `openDesktopHostPipes()` 把两个描述符都打开为拥有它们的流，其 `close()` 只执行一次：销毁请求端，在响应端等待 `end()` 以便排队中的帧送达 Electron，然后销毁写流。`runDesktopHost` 的停止路径只调用 `pipes.close()`；Host 入口中已不再有 `closeSync`。

`DesktopHostProcess.stop()` 在请求子进程关闭之前置位 `stopping`，`fail()` 会检查该标志。一次有意收尾期间出现的 EOF、零退出码或迟到的管道错误，都是这次调用所要求的结果，因此都不作为失败上报。非零退出码仍然上报，因为那是子进程在退出途中真的失败了。

prune 只在嵌套树可证明与暂存根等价时才删除它。`pruneNestedNodeModules` 现在接收“删除前读取的包映射”，把嵌套树中的每个包与其同名根包比较：`version` 相同，且 `dependencies` 与 `peerDependencies` 映射在忽略键序的情况下相等。比较会递归进入更深的 `node_modules`，因为一个继续向下嵌套的副本无法仅凭其直接子项被证明等价。全部匹配的树（在每一层）作为纯粹的冗余被删除。含有任何不一致包的树 —— 版本不同、同伴映射不同、或根本没有同名根包 —— 予以保留，每个阻断删除的包通过新增的 `PruneResult.retainedNested` 以 `owner -> 嵌套包` 的形式上报。

## Alternatives considered

**设置 `autoClose: false` 并保留显式的 `closeSync` 调用。** 否决：流仍然持有该描述符，其自身的销毁路径仍然会关闭它；`autoClose: false` 改变的是流何时关闭句柄，而不是收尾与流是否竞争这个句柄。描述符需要唯一所有者，而不是一个假装没有所有者的标志。

**在流错误处理器里按名字吞掉 `EBADF`。** 否决：这掩盖的是这类缺陷而不是这个实例，任何 errno 下的第二次描述符关闭仍会到达 `failTransport`，而 Host 之后继承的每个描述符都要再加一个特例。

**上报子进程的干净退出，但为其它情形保留 `'end'` 消息。** 否决：不存在其它干净情形。在没有有意收尾的情况下响应管道到达 EOF，已由退出处理器覆盖，它会区分非零退出码。保留两条上报会让关闭路径有机会发布一条重复且误导的失败。

**用包名清单而不是内容比较来决定删除哪些嵌套树。** 否决：包名清单固化的是今天的依赖集，而不是让删除安全的规则。下一个不在清单上的嵌套副本会在无人复核等价性的情况下被删除。

## Consequences

一次干净的 Desktop Host 停止不再记录传输失败，运维过去在每次插件变更时看到的 `EBADF` 与 `response pipe ended` 两行消失了，真实崩溃也重新成为日志中唯一通过 `onFailure` 上报的内容。收尾仍按既有的 10s/5s/5s 阶梯升级到 `SIGTERM` 再 `SIGKILL`。

两个管道端现在都通过拥有它们的流关闭，这也意味着 `stop()` 开始时仍在排队的写入会先被刷出，而不是被立即销毁截断。

prune 可能保留它过去会删除的嵌套树，因此打包后的 Python runtime 不再小于闭包，但也不再以正确性为代价大于闭包。`pruneStagedClosure` 上报被保留的条目，`build-exe-for-python-sdk.ts` 会逐条记录，于是长出不一致嵌套副本的构建会可见，而不是被静默发布。

等价性覆盖 `version`、`dependencies` 与 `peerDependencies`。仅 `optionalDependencies`、`peerDependenciesMeta`、`exports` 或入口文件不同的嵌套副本会被判为等价并删除。这一边界是有意的：该比较的目的是抓住解析到不同模块图的副本，而其余字段并不参与本 prune 已经建模的闭包遍历。

## Testing

`rsh/Programs/DesktopHost/tests/pipes.spec.ts` 把两个描述符打开为普通文件，断言一次关闭在没有任何流错误的情况下完成且两个描述符都已关闭、排队的响应字节先被刷出、重复的 `close()` 调用共享一次收尾。

`rsh/Programs/Desktop/tests/host-process.spec.ts` 新增用例：启动一个就绪的 Host、停止它，并断言 `onFailure` 从未被调用、也没有记录任何含 `EBADF` 的行。该文件中的 Host 夹具不再在 `destroy()` 之后调用 `closeSync`，因此夹具现在模拟的是真实的 Host 而不是缺陷。

`rsh/Scripts/python-runtime-closure-prune.spec.ts` 覆盖规则区分的四种结果 —— 等价树被删除、不一致副本（版本不同、依赖映射不同、无同名根包）被保留并上报、直接子项之下的不一致也会保留整棵树 —— 以及依赖比较的键序无关性。
