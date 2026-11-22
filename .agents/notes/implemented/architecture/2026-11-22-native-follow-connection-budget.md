# Agent Note: Native JSON follow connection budget

Status: implemented

English | [中文](2026-11-22-native-follow-connection-budget.zh.md)

## Problem

Chrome allows six HTTP/1.1 connections to one host. The native page already keeps the session-list, workspace, jobs, and schedule follows resident, and Files opens another follow. A separate HTTP response for each JSON follow fills that pool, so a unary RPC such as `settings/describe` or `directories/list` never leaves the browser.

The [shared Settings event stream](2026-11-14-shared-settings-event-stream.md) fans Settings callers onto one client stream. Every other page-owned JSON `response()` still opened its own socket.

## Decision

Page-owned JSON `response()` calls on `/api` share one long-lived `POST /api/connection/follow-bus` response, owned by `@redspark/rsh-client-connection`. The caller opens that response with one finite POST and sends each subscribe or cancel as its own finite POST. The Host reads that newline-delimited command, invokes the already registered exact `POST` route in process, and writes that route's status, headers, and body bytes back on the open response.

Unary `call()`, a raw-body `response()`, a non-`/api` channel, and any caller-supplied `fetch` stay ordinary HTTP requests. Direct requests to the registered routes remain. `GET` returns 405, a missing body returns 400, and registering the path throws. The shared response stays open while any of those JSON responses is unfinished and closes after the last one settles. Several resident follows therefore hold one socket, leaving room for a unary RPC inside Chrome's six-connection limit.

The Settings client fanout remains. This bus is the HTTP carrier under every page-owned JSON `/api` `response()`.

Each subscribe re-runs the Host/Origin fence and the browser-session check on that command POST. The browser attaches the current cookie, Origin, Host, and `sec-fetch-site` to the finite POST; there is no pre-subscribe GET. A 401 or 403 refuses the subscribe and closes the bus. The server compares the signed cookie's expiry with the current time using that command's headers, not a cookie copied when the downlink opened. Opening the bus is still refused by the HTTP carrier before any frame is read. Desktop `dsh-app:` requests skip this cookie check because the private-scheme fetch is the authentication; a direct desktop dispatch does not run it either. A follow-bus line is limited to the buffered cap plus 64 KiB, counting the whole finite POST because the carrier classifies it as streaming and does not apply the ordinary buffered cap first. A buffered payload over that cap is 413 and the route is not called. A failure after the status frame is an error frame, and the client ends that body with a stream error. A failure before the status remains HTTP 500. A route's own Response is copied unchanged and does not close the bus.

## Alternatives considered

**Replace `node:http` with HTTP/2.** Browsers do not speak cleartext HTTP/2 to this Host, and a trusted local certificate is a larger launch change. A streaming request body needs HTTP/2, so Chrome reports `net::ERR_ALPN_NEGOTIATION_FAILED` against this cleartext listener. The Settings stream note already rejected replacing the carrier.

**Merge one more feature follow onto an existing socket.** That frees one connection. The page already keeps five follows resident before Files opens `files-follow`.

**Carry unary RPC on the follow bus.** That would replace the request envelope, status codes, and Host tests. Unary calls fit once follows occupy one socket.

## Consequences

A unary RPC still completes while several follows are resident, because those follows share one long-lived response socket rather than a duplex request body. A large image read is a JSON `response()` and is framed on that socket, so follow bytes wait behind the chunk already being written. Raw uploads do not. Each logical follow still counts toward Host `maxFollowers`. An explicit `fetch` override does not join the bus; production native Web uses the page `fetch`, so it does.

Clearing the cookie or presenting an expired signed cookie refuses the next subscribe and closes the bus. A follow already open is not rechecked until that subscribe. The native Web host's separate `maxRequestBodyBytes` is not passed into `createNativeHostConnectionRegistry`, so a non-default native cap does not change this line limit.
