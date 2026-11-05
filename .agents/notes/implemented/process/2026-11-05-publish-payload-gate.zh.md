# Agent Note: 校验已打包的发布产物能解析自身携带的每个说明符

Status: implemented

[English](2026-11-05-publish-payload-gate.md) | 中文

## Problem

同一类缺陷有三种形态，它们都能通过全部源平面门禁，只在 `npm pack` 之后才显形：

1. manifest 声明了 `exports["./native"].default`，而构建从不产出该文件。
2. 文件已产出，但包的 `files` 列表没有列它，tarball 直接裁掉。
3. 文件已发布，但它导入的裸说明符只声明在 `devDependencies` 中，消费者根本不会安装它。

`verify-native-build-output` 通过读取工作树、检查两份随附组合的行，覆盖了前两种。它完全看不到裸说明符：它刻意把自己的范围限定在相对目标上，理由是相对说明符属于产物、裸说明符属于依赖。在此之前，没有任何门禁读过 npm 真正会发布的那些字节。

这个缺口有一个值得命名的形状：每一种形态都比上一种离根因更远一步，而报出的失败永远是 Desktop 打包阶段 `prepare-dsh` 里的 `MODULE_NOT_FOUND`，它点名的是某条 installation 行，而不是真正出错的包。

## Decision

`rsh/Scripts/verify-publish-payload.ts` 对每个声明了 `exports["./native"]` 的非私有 workspace 包（本提交为 176 个）执行真实的 `npm pack`，解开 tarball，并断言产物中的每个模块说明符都能解析：

- **相对说明符**必须解析到同一个 tarball 中的成员。因为产物是一个扁平的成员清单而不是文件树，解析采用候选匹配：字面目标、补上 `.js`/`.mjs`/`.cjs`/`.d.ts`/`.json`，以及目录 index。
- **裸说明符**必须指名一个消费者会安装的包：`dependencies`、`peerDependencies` 或 `optionalDependencies`。只在 `devDependencies` 里找到的说明符会在原因里点明这一事实，因为这正是已经发布出去的那个具体错误。

`node:` 内建模块与该包自己的子路径不属于包关系，在两条规则适用之前就被排除。

### 豁免条件取自既有政策

当既有政策已经说明某张模块表会提供某个裸说明符时，该说明符不需要任何安装段落。两个来源是读取的，而非重述的：

- 直接从 `rsh/Compatibility/DSH/web/frontend/src/platform.ts` 导入的 `PLATFORM_MODULES` 与 `PRELOADED_CLIENT_EXTERNALS`。仓库刻意不把这些写进包 manifest：基线外部模块对每个动态 bundle 都是隐式的，不得在 manifest 中重复（`rsh/Programs/Web/client/AGENTS.md`，"Shared modules and the module graph"）。直接导入该常量，意味着这条门禁既不会偏离它描述的模块表，也不会在该模块表变化时腐化。
- 包自身的 `dsh.client.external` 条目（`tsdown.client.ts` 把它们读进同一个外部模块集合）。这样的精确请求由动态 row 或某个静态表键来应答，因此同样不自行安装任何东西。

豁免所保留的区分，正是第三种缺陷所依赖的那条区分：client 包 `devDependencies` 里的 `react` 和 `@redspark/rsh-client-store` 合法，因为模块表提供它们；而 `@redspark/rsh-host-open-in-app/shared` 不合法，因为既没有表条目也没有安装段落应答它。

### 成本

每个包一次 `npm pack` 加一次 `tar -xzf`。在本检出上以 32 个并发子进程实测：176 个包打包耗时约 80–120 秒墙钟，摊算约每包 0.5–0.7 秒；串行时约每包 3.3 秒（workspace 包内的 `npm pack` 需要付约 2.5 秒的固定 npm 启动开销，它压过了真正的工作量）。并发池取自 `RSH_PUBLISH_PAYLOAD_CONCURRENCY` 或 `availableParallelism()`。解包在 Node 内完成，而不是每包再起一个子进程，并把整个 tarball 按成员各读一次。

每次 `tar` 调用都使用 staging 相对路径。GNU tar 会把开头的盘符当作远端主机，所以绝对 Windows 路径会以 `Cannot connect to D:` 失败；发布脚本既有的 `tarballFiles`/`capture` 助手出于同一原因已经使用相对形式。

## Alternatives considered

**扩展 `verify-native-build-output`，而不是新增一条门禁。** 那条门禁针对不同的输入回答不同的问题：两份随附组合对工作树。裸说明符是被刻意排除在外的，模块文档也写明了这一点。把产物检查折进去会让一条门禁同时读工作树与 tarball，并悄悄把一条文档写明范围为「随附组合的行」的门禁扩大到每个已发布包。

**静态重实现 `npm pack` 的文件选择。** `publint-all` 依据 `files` 加 packlist 约定近似出发布视图，这足以 lint 一个 manifest，但不足以证明 tarball 里有什么：第三种缺陷恰恰就是两者之间的不一致，只有真实打包才能定论。`publication-payload.ts` 已经为源码与 map 成员吸取了同一个教训。

**在进程内解析 tarball，而不调用 `tar`。** 一个正确的解析器必须处理 GNU 长文件名、PAX 扩展头、prefix 拼接，以及 npm 可能产出的多种 tar 方言。仓库的发布脚本已经在调用 `tar`，而第二份手写解析器会是一份无人审查的实现，它的缺口以静默方式失败——对它从未读到的成员报告产物干净。使用系统 tar 只保留一份实现。

**对所有包的 `devDependencies` 裸导入一律报红。** 如豁免一节所述，其中一部分是正确的。在本检出的 Native 入口中，只在 `devDependencies` 里出现的裸说明符共 24 个：22 个是分布在 10 个 Client 包上的模块表基线条目，只有另外 2 个是缺陷。一律报红会让这条门禁错得比对的频繁 11 倍，而错成那样的门禁会被关掉。

## Consequences

产物平面现在有了针对源平面一直漏掉的同一批缺陷的门禁，而它在一棵所有其他门禁都全绿的树上，第一次运行就报出了四个真实缺陷。

其中两个已在本变更中修复。`ui-settings-general` 与 `ui-settings-plugins` 声明了 `exports["./native"]` 和针对 `lib/native.js` 的 `files` 条目，而它们的 `tsdown.config.ts` 只调用了 `clientBundle`，所以该文件从未被构建；现在它们调用 `staticLinkedLeaf` 并发布 `lib/**/*.css`，与同一提交（`5383af6b7d`）中获得 Native 半边的那五个同级包一致。它们是第一种缺陷的现成例子：该提交自己的说明就写着，一个声明了 `./native` 却不构建它的包，等于把一条通向虚无的路径交给消费者。

其余的需要 `CLIENT_RUNTIME_DEPENDENCIES` 条目，这正是政策为「已发布的 Native 叶子运行时可达、而否则只会被声明为开发依赖」的 Client 包准备的、经评审的机制：

- `@redspark/rsh-client-ui-sidebar` → `clsx`。它的叶子在运行时导入 `clsx` 做类名组合。
- `@redspark/rsh-client-ui-input-trigger` → `@redspark/rsh-file-reference`。它的叶子为触发器检测谓词导入 `@redspark/rsh-file-reference/grammar`，与同级决策记录的裸导入相同。
- `@redspark/rsh-client-ui-settings` → `@redspark/schemastery`。Native 插件用 `new Schema` 构建 schema，静态叶子把这个导入外置。
- `@redspark/rsh-client-ui-settings-plugin-inventory` → `@redspark/rsh-brand`。它的快照辅助函数从已打包入口调用 `brandString`。

每一项都在随附的 `native-web` Client 组合中，因此导出的 `/native` 入口正是 Desktop 浏览器 bundle 所解析的对象。在政策点名它们之前，`verify-package-dependencies` 会以「仅 `devDependencies`」拒绝它们；而政策自身的文档字符串要求存在源码使用——`/native` 提供了这一点，该入口现在也在门禁所检查的安装段落中得到了满足。

这条门禁刻意不进入 `ci-static`：那条通道不拥有构建，而两条产物门禁都要读构建出的 `lib/` 输出。它与 `verify-native-build-output` 并列加入 `ci-windows-observational`，即构建归属该通道之处。

## Testing

`rsh/Scripts/verify-publish-payload.spec.ts` 钉住了检测边界：相对目标缺失会报出，存在则通过，目录 index 能解析，`new URL(relative, import.meta.url)` 算作相对说明符，目录 URL 在其下有成员时视为存在，`.ts` URL 由已产出的 `.js`/`.cjs`/`.mjs` 同名文件满足，条件 URL 的两个分支都会检查，`devDependencies` 中的裸说明符带着具体原因报出，每个安装段落中的裸说明符通过，无人引用的产物成员不报出，两条模块表豁免成立而平台模块名的子路径不成立。tarball 缺少 `./native` 成员时，不会因此藏起同一包里另一处坏掉的相对导入。语料选择谓词单独钉住，使没有 Native 入口的包留在范围之外，而不是被隐含。

这条门禁是拿真实缺陷而非仅夹具验证的：从 `ui-sidebar` 的 `files` 中删掉 `lib/client/SidebarRoot.module.css`，违规计数从 2 升到 3 并点名了精确说明符；把 `@redspark/rsh-util-values` 移出 `dependencies`，计数升到 13，覆盖 `@redspark/rsh-session` 的九个已产出文件。逐一还原后计数回落到原值。
