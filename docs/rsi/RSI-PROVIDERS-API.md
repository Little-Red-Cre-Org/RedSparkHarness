# 供应商设置的接口契约

> 面向桌面客户端的 provider 编辑页。响应字段与拒绝文案都取自真实服务的实测输出，不是设计稿。
> 后端实现：`rsi/providers.py`（文件读写）、`rsi/server.py` 的 `Application.providers` / `Application.patch_provider`。
>
> **定位说明（写给后来人）**：`config.toml` 是**过渡期的存储**，`rsi/providers.py` 只是「编辑这个文件的工具」，**它不是 RSI 的配置模型**。真正的配置转换层是 `rsi/oh_config.py`，它负责把 TOML 里的块翻译成引擎实际使用的 provider 对象。等引擎从 codex 换到 OpenHands 之后，这一页描述的接口会随之退役；不要把它当长期方案往上叠功能。

---

## 一、`GET /settings/providers`

读 `.rsi/engine-home/config.toml`，返回里面所有的 `[model_providers.<id>]` 块。

```json
{
  "home": "D:\\RSIHarness\\.rsi\\engine-home",
  "providers": [
    {
      "id": "alpha",
      "label": "Alpha Labs",
      "base_url": "https://alpha.test/v1",
      "wire_api": "responses",
      "has_key": true,
      "key_source": "token",
      "active": true
    },
    {
      "id": "beta",
      "label": "Beta",
      "base_url": "https://beta.test/v1",
      "wire_api": "chat",
      "has_key": true,
      "key_source": "env_key_unset",
      "active": false
    }
  ]
}
```

### 顶层字段

| 字段 | 含义 |
|---|---|
| `home` | 这份配置所在的引擎目录绝对路径。**只用于显示和排错**，客户端不要拿它拼路径，也不要把配置写到别处去 |
| `providers` | 按文件里的先后顺序排列，不重排、不按字母排序。文件缺失或解析失败时是空列表 `[]`（不是错误） |

### `providers[]` 每个字段

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | string | TOML 里 `[model_providers.<id>]` 的 `<id>`，也是 PATCH 路径里那一段。**不是给人看的名字** |
| `label` | string | 块里的 `name = "..."`。没有 `name` 时**回退成 `id`**，所以这个字段永远非空，可直接当显示名 |
| `base_url` | string | 块里的 `base_url`。缺失时是空串 `""` |
| `wire_api` | string | 块里的 `wire_api`，实测取值 `"responses"` 或 `"chat"`。缺失时是空串 |
| `has_key` | bool | **是否配置了凭据**，不是凭据本身。`experimental_bearer_token` 和 `env_key` 任一存在即为 `true` |
| `key_source` | string \| null | 引擎**实际会用哪个**凭据、它现在**能不能用**。见下表。这是给界面说人话用的，`has_key` 只管「配没配」 |
| `active` | bool | 是否是 `model_provider` 顶层键点名的那个块。**整份列表里最多一个 `true`**；一个都没有说明配置本身有问题，界面该报警而不是猜 |

### `key_source` 的四种取值

| 取值 | 含义 | 界面该说什么 |
|---|---|---|
| `"token"` | 文件里有 `experimental_bearer_token` 明文，引擎用它 | 一切正常，密钥框显示 `••••••` |
| `"env_key"` | 文件里没明文，`env_key` 指向的环境变量**在 RSI 进程里存在且有值** | 一切正常，显示「凭据来自环境变量 `XXX`」 |
| `"env_key_unset"` | 指向了变量，但**在 RSI 进程里取不到**（不存在，或存在但值为空） | 必须警告，见下 |
| `null` | 两种凭据都没有 | 「未配置凭据」，调用这个供应商会失败 |

`has_key` 和 `key_source` 是**两个问题**：`has_key` 回答「文件里写了凭据没有」，`key_source` 回答「跑起来时到底有没有可用的 key」。所以 `has_key: true` + `key_source: "env_key_unset"` 是合法组合，而且是**最需要界面说话的那一种**。

**`env_key_unset` 的文案必须写清楚重启，不能只显示一个状态码。** 环境变量是在 RSI 进程启动时快照下来的（`os.environ`），Windows 上改完系统环境变量，**已经跑着的进程读不到新值**。用户在系统里设好变量、刷新设置页、还是看到 `env_key_unset`——他会以为是功能坏了，其实该重启的是 RSI 本身。建议原文：

> 环境变量 `XXX` 在 RSI 当前进程里取不到。如果刚设好这个变量，需要**重启 RSI** 才会生效。

**变量存在但值为空，和不存在是一回事**，都归到 `env_key_unset`，不另设状态。引擎的判定是 `if value and value.strip()`，空串等于没有；分成两种状态只会让界面多一句没用的话。

### 明文 token 和 `env_key` 同时存在时

引擎**先读明文 token，有就完全不看 `env_key`**（`rsi/oh_config.py` 的 `provider_token`）。所以手工编辑出一个两者都有的块时，`key_source` 报 `"token"` —— 报 `env_key` 会描述一个引擎并不使用的凭据，界面会把错的那个显示成生效中。

这种块可以通过 PATCH 单独改其中一个（不然用户没法自救），但**不能在一次请求里同时写两个**，见下。

### 关于 `has_key`：值永远拿不到，这是设计

- `has_key: true` 只表示「有凭据」，**响应里没有、也不会有凭据的值**。`Provider.describe()` 是 `Provider` 对象唯一的公开出口，它不含 token 字段，所以这个值不会被日志、不会被告警、不会被回显。
- `env_key = "BETA_KEY"` 这种「凭据在环境变量里」的配置同样算 `has_key: true`——从服务端看它和明文 token 没有区别，界面同样只需要显示「已配置」。
- 界面的密钥框请这样处理：`has_key: true` 时显示占位符（如 `••••••`）并且**输入框初值为空串**；用户没动这个框就**不要把这个字段放进 PATCH body**（或者放空串，见下）。

---

## 二、`PATCH /settings/providers/<id>`

改一个**已存在**块里的字段。请求体是 JSON 对象，只列要改的字段。

### 可写键（四个，外加一个别名）

| 键 | 说明 |
|---|---|
| `base_url` | 必须是 `http://` 或 `https://` 开头且带主机名 |
| `wire_api` | 必须是 `"responses"` 或 `"chat"` |
| `experimental_bearer_token` | 凭据明文本身 |
| `env_key` | **环境变量名**，不是密钥。必须是合法变量名（`[A-Za-z_][A-Za-z0-9_]*`），如 `MY_API_KEY`。写了它，引擎会去环境变量里取值，文件里不再留明文 |
| `api_key` | **`experimental_bearer_token` 的同义词**，界面用这个更自然。写进去落盘时仍然叫 `experimental_bearer_token` |

不可写的：`name`（显示名）、`http_headers`（含第二个凭据，界面不该碰）、以及任何其它键 → **400**。

### 两种凭据：一次只能设一个

写 `env_key` 是在做一件比写明文更好的事——把密钥从磁盘上拿走。但它和明文 token 是**互斥**的，不是并列的：

- **一次请求里同时给 `api_key` 和 `env_key` → 400**，文件一个字节不动。理由不是洁癖：引擎先读明文、有就不看变量，两个都写等于让 `env_key` 静默失效，而请求方根本没法表达「我到底想要哪一个」。
- **只给其中一个 → 只改那一行，绝不顺手删另一个。** 这个模块的承诺是「只改你点名的那一行，其余字节不变」，自动删行会让它第一次出现「改 A 却动了 B」。要切换凭据来源，界面引导用户先设新的、再由用户显式处理旧的那个。
- 文件里**本来就有两者**（手工编辑造成的）时，允许单独改其中任何一个，否则用户没法自己修。

### 改 `env_key` 有个前提：那一行得先存在

这个模块**替换**行；块里还没有这一行时，它会**在块内新增一行**（见下一节）。但：

- 块里已经有 `env_key = "..."` 这一行 → 原地改这一行。
- 块里只有明文 token、没有 `env_key` 行 → **新增一行** `env_key = "..."`，明文 token 那一行**原样保留**。
- **块本身不存在** → 404 `provider gamma is not in <path>`，**不会**替你新建这个块。新增一行和新建一个 provider 是两件事。

### 新增行的落点与风格

新增的键行插在**该块最后一个非空行之后**，不是块尾空行之后（那样会贴到下一个 `[section]` 前面），也不是块头 `[model_providers.xxx]` 那行之前。

- **缩进**跟随块内第一个键行的前导空白，原样复制；块内一个键行都没有就用空缩进。
- **行尾符**跟随文件本身的风格：CRLF 文件里新增的行也是 CRLF，不会混进一个 LF。
- 子表 `[model_providers.x.env]` 会终止块的范围，新增行不会跑到子表里去。

新增和替换**合并成一次 `os.replace`**：同一次请求里「改 base_url + 新增 env_key」要么都成、要么都不成。

### 「只发改动过的字段」+「空串 = 不改」

这两条是同一个约定的两面：

1. **只发改动过的字段**。没动的字段不要出现在 body 里，否则等于让服务端重写它。
2. **空串（或纯空白）= 不改这个字段**。服务端在路由层直接跳过，返回 200 和**当前实际状态**。

第 2 条不是宽松，是**保护**：被遮罩的密钥框在「用户没动」时会回传空串，把它写下去会**擦掉一个能用的凭据**。所以：

- 密钥框留空 → 200，凭据保持原样 → 看响应里的 `has_key` 确认还在。
- **副作用要注意**：如果把 `base_url` 清空再保存，界面会拿到 200「成功」但**什么都没变**。这对密钥字段是对的，对 `base_url` 有点反直觉——界面若允许清空 `base_url`，请在 UI 上明确写「留空 = 保持原值」，不要让用户以为清空了。

### 成功响应

```json
{"ok": true, "provider": {"id": "alpha", "label": "Alpha Labs", "base_url": "https://new.test/v1", "wire_api": "responses", "has_key": true, "key_source": "token", "active": true}, "changed": ["base_url"]}
```

`provider` 是**写完之后重新从文件读回来的那一个**，不是请求体的回声。界面可以直接拿它刷新显示，尤其是 `base_url` 被空串跳过时，这里回的是真实值。

### 失败：一条请求就是一次编辑，失败即未改动

| 情况 | 状态 | body |
|---|---|---|
| `<id>` 不在文件里 | 404 | `{"error": "provider nosuch is not in <config.toml 路径>"}` |
| 块不存在 | 404 | `{"error": "provider gamma is not in <config.toml 路径>"}` |
| body 不是 JSON | 400 | `{"error": "body is not JSON: Expecting value: line 1 column 1 (char 0)"}` |
| body 为空对象 | 400 | `{"error": "body needs at least one of base_url, wire_api, experimental_bearer_token, env_key, api_key"}` |
| 含不可写键 | 400 | `{"error": "cannot change http_headers; writable keys are base_url, wire_api, experimental_bearer_token, env_key, api_key"}` |
| 值不合法 | 400 | `{"error": "wire_api must be one of responses, chat, not sse"}` |
| 变量名不合法 | 400 | `{"error": "env_key must be an environment variable name like MY_API_KEY, not my key"}` |
| 同时给了明文和 `env_key` | 400 | `{"error": "a provider takes either experimental_bearer_token or env_key, not both; set one and leave the other alone"}` |
| 配置文件不存在 | 409 | `{"error": "there is no <路径> to change"}` |

**任何 4xx 都意味着文件一个字节都没变。** 请求体里的字段先全部校验（可写键、值格式、provider 存在、要改的行在不在），全部通过才开始写，而且**整批字段一次 `os.replace` 落盘**。所以 `{"base_url":"https://ok.test/v1","wire_api":"sse"}` 拿 400 之后，`ok.test` **不会**进文件——这是实测过的。

> 早期版本是逐字段写盘的，上例里 `ok.test` 会留在文件里（半成功）。这个行为已修掉；如果看到旧结论，以本节为准。

唯一残留的非原子场景是**落盘那一刻的 OSError**（磁盘满、文件被独占）。那种情况下服务返回 500，且因为只有一次 `os.replace`，不会出现「前一个字段进去了、后一个没进去」。

成功时响应带 `changed` 数组，列出真正改动的键（用规范名 `experimental_bearer_token`，不是别名 `api_key`）；全部是已有值时 `changed` 为 `[]`。

---

## 三、其它要知道的

- **原子写**：先写同目录 `.tmp` 再 `os.replace`，中途失败不会留下半个文件；`.tmp` 残留在失败后会被清掉。`os.replace` 在 Windows 上需要目标文件的删除权限，若此时正有读者打开着它（引擎读 config 的那一瞬间就是这样）会报 `PermissionError`，所以保存会对这种情况重试约 200ms 再放弃。
- **只改目标那一行**：颜色注释、空行、`http_headers` inline table、旁边别的 provider 块，全部字节级不变。`[model_providers.x.env]` 这种子表里同名的键不会被误改。
- **不产生事件**：设置写入**不进事件流**。等在 `adopt` 上的订阅者不会被一次 base URL 编辑叫醒。界面不要靠 SSE 感知设置变化，自己 GET。
- **改动何时生效**：引擎下一轮会重读 `config.toml`，所以保存后**不需要重启服务**。已经在跑的 run 用的是它启动时的配置。
- **不做增删 provider**：这一版只改已存在块的值，或在已存在块里新增一个键行。要加新供应商，现在得手工编辑 `config.toml`。
- **无鉴权**：服务只绑 loopback，没有 auth、没有 TLS。这个接口会改一个含凭据的文件，不要把它暴露到网络上。

---

## 四、客户端调用示例（伪代码）

```python
providers = get("/settings/providers")["providers"]

# 每张卡片先看 key_source 决定密钥区怎么画
for p in providers:
    if p["key_source"] == "env_key_unset":
        warn(f"环境变量在 RSI 当前进程里取不到，改完需要重启 RSI 才生效")

# 用户编辑了一个卡片
body = {}
if card.base_url.get() != card.original["base_url"]:
    body["base_url"] = card.base_url.get()
if card.key.get():                      # 空 = 没动，不放进 body
    body["api_key"] = card.key.get()
if card.wire_api.get() != card.original["wire_api"]:
    body["wire_api"] = card.wire_api.get()

if not body:
    return                              # 什么都没改，不必发请求

status, payload = patch("/settings/providers/" + card.original["id"], body)
if status != 200:
    show_error(payload["error"])
    # 失败时文件没变，但重新 GET 一次仍是最省心的刷新方式
    providers = get("/settings/providers")["providers"]
```
