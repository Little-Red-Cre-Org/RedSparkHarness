# Agent Note: Browser-owned grants for Native read-only tools

Status: implemented

English | [中文](2026-10-10-native-browser-read-only.zh.md)

## Problem

Reading an authenticated browser page requires the user's tab permission and revocation semantics. Anonymous HTTP fetch does not have that authority. Reusing a browser automation bridge would also expose navigation and mutations outside this feature's scope.

## Decision

The [browser package](../../../../rsh/Modules/Official/web/browser-read-only/README.md) joins its service, local Provider and tool Consumer because they evolve together. A Chrome `activeTab` extension owns explicit document grants. Native Messaging binds the extension's fixed origin to a private relay; a per-launch token authenticates the relay to a local pipe. The discovery file belongs in the OS user's private directory. It is created exclusively, not overwritten or reused after a crash. The relay only forwards bounded frames and owns neither a Harness application nor a Session.

The extension revokes on navigation, reload, tab closure and disconnect. Read responses must still match a live grant, document and URL. Timeout, cancellation and removal invalidate pending recipients. Reconnection needs fresh authorization. Browser grants apply to the connected Host; the existing conversation approval authority must separately allow a consuming read. The existing tool pipeline logs source text, errors and approval decisions before subsequent model use. Page text is untrusted; no cookie, form-value, click, input or navigation operation exists in the tool protocol.

An explicitly selected Native Desktop conversation can enter the existing Code OSS workbench through the shell's private carrier. The Native Client implements the same task and plain-text handoff messages, validates the parent/channel and recorded workspace, and retains the original Host's tool approval and Session writer. The source-development linked-profile flag applies to Native packages as it does to legacy bundles; packaged applications still require contained installed packages. This enables browser tools inside that Native conversation without installing a Cordis bridge or changing the daily default profile.

Browser actions and pipe messages have separate asynchronous boundaries. Frame limits apply per message so stream batching does not reject valid traffic. The receiver allocates the declared body only after header validation and copies each fragment once, rather than repeatedly copying the accumulated frame. Authorization commits after document validation and a current grant-count check, preserving an earlier grant on failed replacement. Popup commands are serialized while unchanged page controls retain keyboard focus across polling.

## Alternatives considered

An HTTP fetch provider cannot represent an authenticated browser document. A mutation-capable automation bridge weakens the read-only promise. A second Session writer or model client would split durable authority. Browser-wide host permissions would grant more than a deliberate click on one tab. Persisting grants across reconnect would hide lost document identity. These alternatives are excluded.

## Consequences

Windows Chrome needs one local registration and an unpacked extension. Reading requires both browser authorization and conversation approval. Revocation stops future reads, not already persisted or transmitted content. Only top-document text is supported; other engines, frame extraction and page operations require separate decisions. Local components have no service subscription; configured model calls remain independently billable.

The [web capability decision](2026-06-24-web-capability-seam.md) continues to own public search and fetch. Its provider-selection rationale is not superseded; this capability has a different permission authority.
