# Agent Note: spill 策略跑在 Native 工具注册表上

Status: implemented

[English](2026-11-07-native-spill-policy.md) | 中文

## Problem

随附的 Native 组合装了 `spill-local`——spill 存储——却没有任何东西使用它。Cordis base bundle 把这个存储与 `spill-policy` 配对，后者把超大的纯文本工具结果收敛成预览加定位符；Native 组合没有这一行，于是 Native 会话把整份工具输出原样塞进模型上下文，而 Cordis 会话不会。那个存储是死重。

## Decision

Native 工具注册表暴露了与 Cordis 相同的两个扩展点，因此移植保留策略的每一项决策，只在如何抵达上不同：

| Cordis | Native |
|---|---|
| `ctx.on('tools/post-execute', …, { prepend: true })` | `tools.postResult(policy)` |
| `ctx.on('tools/ptc-dispatch-log', …, { prepend: true })` | `tools.postPtcDispatchLog(policy)` |
| `exec.agent?.session.header.id` | `call.session.header.id` |
| `ctx.get('spillStore')` | `context.optional('spillStore')` |
| `decision.kind !== 'accept'` | 选定的结果本身就是被接受的那个 |

两个 Native 签名存在实质差异，不是措辞差异：日志策略会收到原始结果与它自己的取消信号，并返回被记录的 `{ content, isError }` 而不是内容数组，因为分派日志同时记录子调用是否失败。`saveText` 同样接收本次调用的信号，因此被取消的调用会停下它的写入。

Cordis 策略的每一项判断都被保留，因为每一条都是规则而不是实现细节：

- 省略上限即不注册任何策略。
- 上限不是非负整数时在装载期失败，绝不按调用失败——否则保留器的预算断言会在每次超大调用里抛出，把成功的工具结果变成错误。
- notice 自身的字节开销被预留在上限之内，并按最坏省略位数计价，使预留在上界意义上覆盖真实值。
- 当仅 notice 就会超过上限时不存在上限内的替换，于是保留原内容。
- 面向模型的臂跳过 `read` 与嵌套调用；日志臂两者都收敛，因为日志副本不是模型上下文，而 `read` 恰恰是产生巨大日志的那个工具。
- 任何失败——没有会话属主、没有存储、存储抛错——都保留原始内联内容。

## Alternatives considered

**让策略只留在 Cordis 侧并删掉存储行。** 否决：存储只有通过策略才有用，删行等于把上下文收敛从 Native 会话里移除，而不是移植。

**另写一套 Native 专属的收敛机制。** 否决：`TextRetainer` 与 `formatSpillNotice` 已经是共享的，第二套机制会让两个运行时截断结果不同——notice 的拼写会被持久化并由 `notice.ts` 识别。

## Consequences

- Native 会话以与 Cordis 会话相同的方式收敛超大的纯文本工具结果，上限同为 50000 字节。
- 存储行在 Native 组合里现在有了消费者。
- 覆盖：`tests/native.client.spec.ts` 钉住注册决策（省略上限、拒绝非法上限），以及面向模型的八条规则与日志臂两条。移除 `read` 跳过、上限不变量、存储失败守卫，各自只让自己那一条变红。
