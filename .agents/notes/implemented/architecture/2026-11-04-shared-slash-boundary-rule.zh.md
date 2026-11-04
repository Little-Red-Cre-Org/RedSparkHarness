# Agent Note: 两侧客户端共用一条 `/` 边界判据

Status: implemented

[English](2026-11-04-shared-slash-boundary-rule.md) | 中文

## Problem

Native 的两个界面在互相矛盾的规则下提供 `/` 菜单。Web 触发流水线在草稿开头、空白之后与标点之后接受斜杠；Native composer palette 只在草稿开头接受。同一个按键因此在一边打开菜单，在另一边只是打出一个普通字符。

较窄的那条规则是移植时的简化，不是产品决定。`ui-commands` 早就按 `req.position === 'leading' || c.hint === undefined` 过滤菜单，说明行内命令行是既定的产品行为，而流水线的 `position` 字段正是表达它的词汇。

## Decision

`@redspark/rsh-client-ui-primitives` 里的 `slashTokenAt` 是唯一的边界判据。`ui-input-trigger` 的 `detectTrigger` 对 `/` 调用它，自己只保留属于检测的部分：guard 层级与 leading／inline 位置。Native composer palette 调用同一个函数，不再持有副本。

斜杠在草稿开头、空白之后（含换行）或标点之后开启 token，而紧跟在词字符之后时只是普通字符。两条例外让它在 URL 中失效：紧跟另一个 `/`，或紧跟一个其后为非空白字符的 `:`。扫描向左走到第一处空白为止，因此 token 的结束方式与普通单词一致。

判据与移植过来的流水线完全一致。它本来就以自身规则拒绝 `see src/main` 与 `1/2 cup`——两者斜杠左边的字符都是词字符，而词字符会关闭边界。这两种情况都不需要专门分支，两侧现在靠构造而非靠两份碰巧一致的实现来保持一致。

共享代码的落点：`ui-primitives` 是两个 feature 包都可以 import 的窄静态所有者。通过注入的 `clientNativeInputTrigger` 服务共享走不通，因为 `ui-input-trigger` require 了 `clientNativeConversation`，而后者只有 `native-application` 提供；Native 安装规划会把这一对解析成硬依赖环，使 profile 加载失败。

## Alternatives considered

**通过 `clientNativeInputTrigger` 服务共享。** 这样能让 palette 成为移植新增服务的真实消费方。Native 的 `resolveInstallation` 拒绝它：当 `native-application` require `clientNativeInputTrigger` 而 `ui-input-trigger` require `clientNativeConversation` 时，required 与 `optional` 两种写法都抛 `native-runtime: dependency cycle`，已对真实 planner 验证。要避开这个环就得去掉流水线的 `clientNativeConversation` 边，而那条边承担着它逐 Session 控制器的作用域划分，不能为了 palette 方便而删除。

**收紧判据，要求斜杠后面紧跟字母。** 这样能靠第二条规则把菜单挡在 `1/2 cup` 之外，同时保留 `say /co`。它被否决，因为现有的词字符边界已经处理了分数：斜杠左边的数字会关闭它，额外要求只会禁掉合法的标点相邻输入，却不改变任何分数情形。

**保留两份实现并用一致性测试钉住。** 一致性测试只能在漂移发生之后发现它，并要求两份副本一起改。单一函数让漂移无法表达。

## Consequences

Native palette 现在会在行内斜杠处打开——空格、换行或标点之后——这扩大了它从 composer 索取的按键范围。方向键与 Tab 仍只在菜单打开且存在行时报告为已消费，Enter 在没有行时仍落回提交，因此含斜杠的普通文本照常可用。

`detectTrigger` 不再含有斜杠边界判据，于是斜杠行为的变化只有一处归属和一份 spec（`ui-primitives/tests/slash-token.client.spec.ts`），而不是两份必须保持一致的东西。

`clientNativeInputTrigger` 服务仍然没有 Native 消费方；palette 是通过静态所有者而不是通过该服务拿到判据的。这个缺口不受本决定影响，仍然敞开。

## Testing

`slash-token.client.spec.ts` 在判据定义处钉住它，包括分数情形、URL 例外、token 中间的 caret，以及真正开启 token 的那条斜杠的 offset。`core-detect.client.spec.ts` 覆盖 `detectTrigger` 仍负责的 guard 层级与 leading／inline 位置。`command-palette.client.spec.tsx` 通过 textarea 驱动 palette，断言开头斜杠会打开菜单、而 `see src/main` 不会。
