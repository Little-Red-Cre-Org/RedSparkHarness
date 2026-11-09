# Agent Note: 录制 Native 场景的共享装配器

Status: implemented

[English](2026-11-09-native-scenario-assembler.md) | 中文

## Problem

每个录制的 Native 场景都在手工重复同一段流程：创建隔离的 Harness home、复制 shipped `native-headless` profile、为 profile 会解析到的包建立软链、重写组合、在 Cordis-context 探针之后启动 `dsh --profile`、读取持久化的 Session，最后删除这些目录。带有显式模块软链表的那十二个 harness 每次都把这段装配写一遍，而这段装配恰恰是最容易随 shipped profile 变化而漂移的部分。

在任何一个场景能脱离 Cordis 的 `legacy-headless` profile 之前，这段装配必须先只存在一份。

## Decision

`@redspark/rsh-session-snapshot` 发布 `assembleNativeScenario`，由它拥有整段流程：

- 一个临时 Harness home，含 `work`、`sessions` 与 `profiles/native-headless` 目录
- 以 shipped 组合为起点复制，使场景继承真实产品行、只陈述自己的差异
- `storage`、`fs`、`model` 三行由场景自己的路径与回放脚本填入
- 一组基线模块软链加上场景额外的模块，以及为 profile 局部入口从源码物化的本地包
- `run()`：在 `deny-cordis-context-register` 之后通过 `dsh` 启动 shipped profile，非零退出即失败
- `dispose()`：删除该 home

`reexportPackage` 构造 profile 为触达某个已构建 `./native` 入口所需的小型 `node_modules` 包——回放提供方正是以这种方式安装，而不必改动 shipped profile。

`snapshots/native-headless/fs-read-native.snapshot.ts` 是可以照抄的示例：它把一份已提交的 `snapshots/session/` fixture 通过 Native profile 回放，并断言产出的事件序列与录制相同。

## Alternatives considered

**在装配器里内置固定的模块软链表。** 依实测否决：在声明软链表的十二个 harness 中，没有任何一条软链出现在全部 harness 里，最常见的条目也只出现在七个之中。包集合确实是按场景变化的，因此装配器把它作为输入，而不是自行猜测。

**为每个场景生成 profile 文件并提交入库。** 否决。shipped 组合会随产品变化；提交进去的副本会静默漂移，而这正是本改动要防止的。

**复用 Cordis 的 `materializeProfilePatch` 路径。** 否决。Native patch 按 id 修改既有行、不能新增行，因此场景需要整份重写组合，而不是在其上叠一层补丁。

## Consequences

场景现在陈述自己的差异而非管道：可照抄的示例连断言在内 67 行，而同一场景手写约 120 行。装配器 183 行，一次性成本。

装配器消除的是样板，不是逐场景的实质工作。示例仍然点名七条模块软链与五条追加行，因为那正是该场景实际组合的内容。迁移 `snapshots/session/` 的其余场景因此仍是逐场景工作：每个场景的模块集合与行集合都必须由其 Cordis 组合推导得出，并对录制进行核对。

该示例已登记进快照语料，因此 shipped profile 或装配器一旦漂移，失败的是已落地的测试，而不是将来的迁移。
