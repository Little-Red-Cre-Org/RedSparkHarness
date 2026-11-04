# Agent Note: Native client file upload

Status: implemented

[English](2026-11-04-native-client-file-upload.md) | 中文

## Problem

兼容 file-upload 插件把 Blob 和 stream 发到 `/api/session/uploadFileBinary`，并把精确字节交给 `remote.fileUploads`。Native Web 客户端没有 Cordis remote，也不提供那条路由。`clientNativeSession.uploadFile` 已经会发到 `/api/native-session/file-upload`，但它不报告字节进度，其他 Native 插件也不能 require 它。

## Decision

`@redspark/rsh-client-file-upload` 提供 `clientFileUpload`。Native 入口和兼容插件共用后台 Worker 与页面自有的 Fetch hook。Native 入口把 Blob、stream 和精确字节都发到 `POST /api/native-session/file-upload`，并返回 `NativeSessionFileReceipt`。传输失败和业务拒绝都用 `NativeFileUploadError` 拒绝，没有 `RemoteResult`。精确字节先包成 Blob，这样同一载体可以报告进度。没有 `__RSH_FILE_UPLOAD__` 的 `?fixture` 页面仍会拒绝上传。该入口不接受配置，并安装在随发行的 native-web 客户端组合里。

## Alternatives considered

### Why not call `clientNativeSession.uploadFile` from this package?

那个方法是 Session 客户端自己的传输。它不报告进度，而且 require `clientNativeSession` 会让一个带进度的上传依赖整份 Session RPC 客户端。共享载体已经知道如何发送请求体并观察字节。

### Why not keep the Cordis Remote fallback on the Native entry?

Native host 不暴露 `remote.fileUploads`。在 Native 入口保留这条兜底只能靠导入 Cordis 才能编译，运行时也会失败。Native 路由接受同样的原始字节。

## Consequences

Native 插件可以 require `clientFileUpload` 并观察进度。兼容插件仍使用 Cordis 路由，精确字节仍走 Remote 兜底，所以现有 Cordis 调用方不变。页面自有的 Fetch hook 仍然不会发出 XHR 进度，只有专用 Worker 会。上传仍然不能续传。
