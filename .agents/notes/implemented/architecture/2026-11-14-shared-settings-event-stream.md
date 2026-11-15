# Agent Note: Shared native Settings event stream

Status: implemented

English | [中文](2026-11-14-shared-settings-event-stream.zh.md)

## Problem

The native Web shell opened one `native-session/settings-events` HTTP stream per caller. The shell already holds the session-list, workspace, jobs, and schedule follows. Chrome allows six HTTP/1.1 connections to one host. Four Settings callers plus those two follows filled the sockets, so `POST /api/directories/list` never left the browser and the directory dialog left Open disabled.

`ServerResponse.writeHead` does not send headers until the first body chunk. A Settings stream has no opening frame, so those sockets also withheld their response headers.

## Decision

`createNativeSessionClient` opens one Settings stream and fans each frame out to every `settingsEvents()` caller. The stream closes when the last caller aborts. A caller that subscribes later only sees frames that arrive after it subscribes; the Host does not replay. Aborting one caller ends only that iteration.

`NativeHttpBridge` calls `flushHeaders()` after `writeHead`, so an event stream delivers its headers before the first frame.

## Alternatives considered

**Keep one stream per caller.** That is the arrangement that filled the six sockets.

**Serve the local Host over HTTP/2.** The carrier is `node:http` HTTP/1.1. Replacing it is a larger carrier change, and it would not stop a client from opening an unbounded number of Settings streams.

**Delay the jobs and schedule follows until those panels mount.** Four Settings streams plus the list and workspace follows still fill six sockets.

## Consequences

The directory dialog can list a path while the shell follows are open. A late Settings caller misses frames that arrived before it subscribed. Aborting one Settings caller does not stop the others.
