# Agent Note: 原生 JSON 跟随共用一条连接

Status: implemented

[English](2026-11-22-native-follow-connection-budget.md) | 中文

## Problem

Chrome 对一个主机只允许六条 HTTP/1.1 连接。原生页面已经常驻会话列表、工作区、jobs 与 schedule 跟随，Files 还会再开一条跟随。每条 JSON 跟随各占一条 HTTP 响应时，连接池被占满，`settings/describe` 或 `directories/list` 这类一元 RPC 发不出浏览器。

[共用一条 Native Settings 事件流](2026-11-14-shared-settings-event-stream.zh.md) 把 Settings 调用方扇到一条客户端流上。其余由页面持有的 JSON `response()` 原先仍各自打开一条连接。

## Decision

由页面持有的 `/api` JSON `response()` 调用共用一条长期打开的 `POST /api/connection/follow-bus` 响应，归属 `@redspark/rsh-client-connection`。调用方用一次有限 POST 打开该响应，并把每次 subscribe 或 cancel 各自作为一次有限 POST 发送。Host 读取这条换行分隔的命令，在进程内调用已经注册的精确 `POST` 路由，并把该路由的状态、标头与响应体字节写回这条打开的响应。

一元 `call()`、带原始请求体的 `response()`、非 `/api` 通道，以及任何由调用方提供的 `fetch`，各自仍是普通 HTTP 请求。对已注册路由的直接请求保持可用。`GET` 返回 405，缺少请求体返回 400，注册该路径会抛出错误。这条共享响应在任一 JSON 响应尚未结束时保持打开，最后一条结束后关闭。因此多条常驻跟随只占一条连接，一元 RPC 仍能落在 Chrome 的六条连接限制之内。

Settings 客户端扇出保持不变。这条总线是每个页面持有的 JSON `/api` `response()` 下面的 HTTP 载体。

每次 subscribe 都在该命令 POST 上重新执行 Host/Origin 围栏和浏览器会话检查。浏览器把当前 cookie、Origin、Host 和 `sec-fetch-site` 附在这次有限 POST 上，不再在 subscribe 之前另发 GET。401 或 403 会拒绝这次 subscribe 并关闭总线。服务器用该命令的标头把签名 cookie 的过期时间与当前时间比较，而不是用下行打开时复制的 cookie。HTTP 载体在读取任何帧之前仍会拒绝打开总线。桌面 `dsh-app:` 请求跳过这次 cookie 检查，因为私有 scheme 的 fetch 本身就是认证；桌面的直接分派同样不执行它。一条 follow-bus 行的上限是缓冲上限再加 64 KiB，并且按整段有限 POST 计算，因为载体把它标成流式，不会先套用普通缓冲体上限。超过该上限的缓冲载荷返回 413，路由不会被调用。状态帧之后的失败是错误帧，客户端以流错误结束该响应体。状态帧之前的失败仍是 HTTP 500。路由自己返回的 Response 按原样复制，且不会关闭总线。

## Alternatives considered

**用 HTTP/2 替换 `node:http`。** 浏览器不会对这个 Host 使用明文 HTTP/2，而受信任的本地证书是更大的启动改动。流式请求体需要 HTTP/2，因此 Chrome 对这个明文监听器报告 `net::ERR_ALPN_NEGOTIATION_FAILED`。Settings 事件流那条记录已经拒绝替换载体。

**再把一条功能跟随并到现有连接上。** 那只腾出一条连接。Files 打开 `files-follow` 之前，页面已经常驻五条跟随。

**把一元 RPC 放到跟随总线上。** 那会换掉请求信封、状态码和 Host 测试。跟随只占一条连接之后，一元调用放得下。

## Consequences

多条跟随已经常驻时，一元 RPC 仍能完成，因为这些跟随共用一条长期打开的响应连接，而不是双工请求体。较大的图片读取是 JSON `response()`，字节在这条连接上分帧，所以跟随字节要等在正在写出的块后面。原始上传不走这条连接。每条逻辑跟随仍计入 Host `maxFollowers`。显式传入的 `fetch` 不加入总线；产品里的原生 Web 使用页面 `fetch`，因此会加入。

清除 cookie，或交出已过期的签名 cookie，都会拒绝下一次 subscribe 并关闭总线。已经打开的 follow 要到那次 subscribe 才重新检查。原生 Web host 单独的 `maxRequestBodyBytes` 没有传入 `createNativeHostConnectionRegistry`，因此非默认的原生上限不会改变这条行限制。
