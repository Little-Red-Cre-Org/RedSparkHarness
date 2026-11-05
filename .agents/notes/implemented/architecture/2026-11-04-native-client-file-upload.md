# Agent Note: Native client file upload

Status: implemented

English | [中文](2026-11-04-native-client-file-upload.zh.md)

## Problem

The compatibility file-upload plugin stores a Session file by posting Blob and stream bodies to `/api/session/uploadFileBinary` and by sending exact bytes through `remote.fileUploads`. A Native Web client has no Cordis remote and does not serve that route. `clientNativeSession.uploadFile` already posts to `/api/native-session/file-upload`, but it reports no byte progress and it is not a service other Native plugins can require.

## Decision

`@redspark/rsh-client-file-upload` provides `clientFileUpload`. The Native entry and the compatibility plugin share the background Worker and the page-owned Fetch hook. The Native entry posts Blob, stream, and exact-byte bodies to `POST /api/native-session/file-upload` and returns a `NativeSessionFileReceipt`. Business and transport failures reject with `NativeFileUploadError`; there is no `RemoteResult`. Exact bytes are wrapped in a Blob so the same carrier can report progress. A `?fixture` page without `__RSH_FILE_UPLOAD__` still refuses the upload. The entry accepts no configuration and is installed on the shipped native-web client composition.

## Alternatives considered

### Why not call `clientNativeSession.uploadFile` from this package?

That method is the Session client's own transport. It does not report progress, and requiring `clientNativeSession` would make a progress-capable upload depend on the whole Session RPC client. The shared carrier already knows how to post a body and observe bytes.

### Why not keep the Cordis Remote fallback on the Native entry?

The Native host does not expose `remote.fileUploads`. Sending exact bytes through that fallback would compile only by importing Cordis, and it would fail at runtime. The Native route accepts the same raw bytes.

## Consequences

Native plugins can require `clientFileUpload` and observe progress. The compatibility plugin still uses the Cordis route and the Remote fallback for exact bytes, so existing Cordis callers do not change. A page-owned Fetch hook still does not emit XHR progress; only the dedicated Worker does. Uploads remain not resumable.
