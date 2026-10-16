# Agent Note: Native Sidebar Workspace Trust Dialog

Status: implemented

English | [中文](2026-10-17-native-sidebar-workspace-trust-dialog.zh.md)

## Problem

The native-web sidebar asks the user to trust a Workspace path outside the configured roots, then retries with `trust`. Four gaps kept the dialog from appearing or explaining a refusal:

- Running from source, the profile bundler resolves repository aliases, so the sidebar can check a source `NativeSessionRpcError` class while the native-session client throws the built one. `instanceof` fails and the trust refusal shows as plain text.
- Opening an existing Session from the roster or search called `select()` directly. For a cold, untrusted Workspace the Session RPC fails route admission and returns a generic `native/session` error, which the conversation controller keeps only as text. The trust dialog never opens.
- With the sidebar collapsed, the add-Workspace button set picker state, but the collapsed layout did not render the directory browser, so the button did nothing.
- A protected system directory showed the Host's English message `Workspace is a protected system directory`, with no reason in the user's language.

## Decision

[`dsh-client-ui-sidebar`](../../../../rsh/Programs/Web/client/ui-sidebar/README.md) matches native RPC refusals by `code` (`native/workspace-untrusted`, `native/workspace-forbidden`) and reads the untrusted path from `details.path`. It no longer uses `instanceof NativeSessionRpcError`.

Session rows and search results open through the same `runWorkspaceAction` path as Workspace rows. The injected `admitSession(id, trust?)` finds the Session's registered Workspace and calls `workspaces/create` with its path (and `trust` after approval); the sidebar then calls `controller.select(id)` only if no later click or other navigation superseded this request during admission, and queues it if the controller is loading. A superseded request shows no trust prompt or error. Starting a Session inside a Workspace or adopting a Workspace directory drops any open still in admission. When the selected Session is archived, a queued click or an open still in admission takes precedence over the neighbouring row; an open that has shown its trust prompt (cancelled or not) or failed no longer counts. `workspaces/create` resolves an existing path to its Workspace and admits its route, so an untrusted Workspace raises `native/workspace-untrusted` with its path, and approval persists trust through the existing Host path. `admitSession` waits for the Workspace baseline before deciding a Session has no registered Workspace; Sessions with no Workspace select directly as before.

The collapsed layout renders the same `DirectoryBrowser` as the expanded one. If the trusted retry of a directory adoption fails, the browser reopens with the reason, so the collapsed layout shows it too. A `native/workspace-forbidden` refusal shows the `workspaceForbidden` locale string (English and Chinese) in the directory browser or the sidebar alert, which says the directory is a protected system directory and an agent there could modify or damage system files.

## Alternatives considered

**Keep `instanceof` and isolate the profile bundle from repository aliases.** Rejected for this fix because it changes how every native client artifact resolves, while the code and details already identify the refusal; a code check works for any number of loaded class copies.

**Return `native/workspace-untrusted` from Session RPCs and keep its structure in the conversation controller.** Rejected because it touches the Session controller wire and the controller error state, while Workspace admission already has a trust-aware RPC that the sidebar uses for Workspace rows.

**Translate the Host message on the client by matching its English text.** Rejected because the stable `native/workspace-forbidden` code already exists and text matching breaks when the Host wording changes.

## Consequences

Opening a Session in a registered Workspace now makes one extra `workspaces/create` call before loading it. If the Workspace directory is gone or forbidden, the sidebar alert shows that error instead of the conversation area. The sidebar's New Session button still uses its own path, which this change does not touch.

## Verification

`rsh/Programs/Web/client/native-application/tests/native-shell.client.spec.tsx` makes Workspace creation refuse with a plain `Error` carrying `native/workspace-untrusted` when an existing Session is opened, then checks that the trust dialog opens and approval retries with `trust: true` before the Session loads. It also refuses directory adoption with `native/workspace-forbidden` and checks the localized reason. Screenshots from a source run are in the PR.

`native-sidebar-admission.client.spec.tsx` covers a new Session inside a Workspace dropping a pending admission, an archive falling back to the neighbouring row after a cancelled trust prompt, and an open made before the Workspace baseline still raising the trust dialog.
