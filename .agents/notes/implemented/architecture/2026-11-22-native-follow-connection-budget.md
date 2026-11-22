# Agent Note: Native JSON follow connection budget

Status: implemented

English | [中文](2026-11-22-native-follow-connection-budget.zh.md)

## Problem

Chrome allows six HTTP/1.1 connections to one host. The native page already keeps the session-list, workspace, jobs, and schedule follows resident, and Files opens another follow. A separate HTTP response for each JSON follow fills that pool, so a unary RPC such as `settings/describe` or `directories/list` never leaves the browser.

The [shared Settings event stream](2026-11-14-shared-settings-event-stream.md) fans Settings callers onto one client stream. Every other page-owned JSON `response()` still opened its own socket.

## Decision

Page-owned JSON `response()` calls on `/api` share one duplex `POST /api/connection/follow-bus`, owned by `@redspark/rsh-client-connection`. The Host reads newline-delimited subscribe and cancel frames, invokes the already registered exact `POST` route in process, and writes that route's status, headers, and body bytes back as framed chunks.

Unary `call()`, a raw-body `response()`, a non-`/api` channel, and any caller-supplied `fetch` stay ordinary HTTP requests. Direct requests to the registered routes remain. `POST` reads a streaming body, `GET` returns 405, a missing body returns 400, and registering the path throws. The socket stays open while any of those JSON responses is unfinished and closes after the last one settles.

The Settings client fanout remains. This bus is the HTTP carrier under every page-owned JSON `/api` `response()`.

## Alternatives considered

**Replace `node:http` with HTTP/2.** Browsers do not speak cleartext HTTP/2 to this Host, and a trusted local certificate is a larger launch change. The Settings stream note already rejected replacing the carrier.

**Merge one more feature follow onto an existing socket.** That frees one connection. The page already keeps five follows resident before Files opens `files-follow`.

**Carry unary RPC on the follow bus.** That would replace the request envelope, status codes, and Host tests. Unary calls fit once follows occupy one socket.

## Consequences

A unary RPC still completes while several follows are resident, because those follows share one socket. A large image read is a JSON `response()` and is framed on that socket, so follow bytes wait behind the chunk already being written. Raw uploads do not. Each logical follow still counts toward Host `maxFollowers`. An explicit `fetch` override does not join the bus; production native Web uses the page `fetch`, so it does.
