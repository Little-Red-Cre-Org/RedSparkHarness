# Agent Note: 会话日志只有一个纯文本默认值

Status: implemented

[English](2026-10-19-session-log-encoding-default.md) | 中文

## Problem

会话日志的物理编码由三处决定，而三者并不一致。所有已发布 profile 模板都写 `compression: 'none'`，Desktop profile 写入器沿用这一选择；而 JSONL 后端在未提供该字段时回退到 `zstd`。于是同一个产品，经已发布 profile 存储为纯文本，经任何省略该字段的组合却存储为压缩帧——包括只配置了 `root` 的挂载。

这一分裂之所以一直不可见，是因为没有任何单一界面指出过它。一个「日志没法用 `cat` 读」的支持问题和一个「日志涨得太快」的问题，都出自同一个产品，只取决于凑巧是哪个组合挂载了后端。它也让编码规则无法陈述：`inspectSessionRootCompression` 报告的是某个根**已经**持有的编码，所以新建根会用哪种编码，只能靠点名是哪一层挂载了后端来解释。

这三项决定在 P6 交接中被记为未决产品问题。但当一个默认值是三层中已有两层一致采用的，它就不是待拍板的产品选择，而是后端在与已发布产品不一致。

## Decision

后端默认值是 `none`，与所有已发布 profile 模板和 Desktop profile 写入器所选的编码相同。`DEFAULT_COMPRESSION` 以及随之而来的 `JsonlCompressionSchema` 默认值都是纯文本；Zstandard 通过显式设置 `compression: 'zstd'` 来选择。

选纯文本作默认值，是因为产品本来就在写它，也因为会话日志是证据：运维可以直接阅读、grep，并把某一行交给缺陷报告。压缩则保留为按根显式选择的能力，供宁愿花 CPU 换磁盘的部署使用。一个根仍然只属于一种编码，拒绝混合编码的行为不变。

## Alternatives considered

**默认改为 `zstd` 并同步修改模板。** 否决：这与产品已经在发布的方向相反，且为了没人要求过的磁盘收益，剥夺了常见场景的可读性；还要迁移每个既有已发布 profile 所创建的根。

**保留两者默认值不同，并把这个差异写进文档。** 否决：这等于继续让一个不可见的挂载细节决定同样的行为。P6 交接之所以把它列为待决问题，正是因为这个差异无法用产品自身的规则解释。

**把编码改为必填、不留默认值。** 否决：`root` 是唯一的必填配置，且每个已发布组合本来就写明了编码；增加必填字段只会给手写组合增加一种失败方式，而不改变任何已发布 profile 的实际存储。

## Consequences

省略 `compression` 的组合现在写入换行分隔的 UTF-8，外部行读取方无需经过后端即可读取。依赖继承来的压缩默认值的部署，现在必须显式写 `compression: 'zstd'`。

既有根不受影响：每个根保留它持有的编码，`inspectSessionRootCompression` 仍会报告它，而后端配置编码与根编码不一致时的拒绝也仍然生效。改变的只是为**新建**根所做的选择。

包 README、Zstandard 会话日志 Agent Note 与两个 keyless profile smoke 中的编码规则，现在都陈述纯文本默认值。headless smoke 是唯一端到端观察它的地方：其 fixture 仅设置 `root`，因此它断言的是默认值而非配置值。

## Testing

`zstd.spec.ts` 在每个演练 Zstandard 帧结构的挂载处显式固定 `compression: 'zstd'`，使这些用例测试的是编解码而非默认值；其 contract fixture 也写明了它要演练的编码。

编码选择测试组新增一个用例：仅用 `root` 挂载后端，断言写出的产物是纯文本 `.jsonl` generation，且旁边没有 `.jsonl.zstd`——这正是该默认值对用户可见的后果。
