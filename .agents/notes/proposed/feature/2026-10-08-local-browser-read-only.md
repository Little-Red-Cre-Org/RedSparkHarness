# Agent Note: Local browser read-only access

Status: proposed

English | [中文](2026-10-08-local-browser-read-only.zh.md)

## Problem

The zero-budget workflow needs content from a user-authorized local browser tab. The [Web service](../../../../rsh/Modules/Official/web/web/README.md) fetches URLs; its request does not carry a tab identity or revocable browser grant. Fetching a URL cannot establish access to an already open authenticated tab. The feature must coexist with ongoing IDE work without changing Desktop startup or creating another Session writer.

## Proposal

Keep the first implementation independently selectable and read-only. A browser-owned grant identifies the authorized site and tab. Each read rechecks that grant and the current page identity before returning a bounded title, URL, and visible text. Navigation, revocation, disconnect, and timeout invalidate the pending read; no automatic reconnect or permission expansion is part of this scope. The extension excludes form values, credentials, and hidden content from the result.

The complete implementation needs a browser authorization and extraction provider, a typed service definition, and a model tool consumer. The tool permits only page reading; unsupported operations fail at dispatch, including calls that bypass the visible tool list. Present the source URL, title, truncation, and read/error state in the existing tool card. Treat page text as external untrusted data. Use the owning application's tool-result persistence and [Native tools](../../../../rsh/Engine/core/native-tools/README.md) policy, approval, and cancellation paths; do not open independent Session storage. Select the final native-profile integration only after checking its current application consumer.

### Compatibility assessment

On 2026-10-08, the [upstream bridge manifest](https://raw.githubusercontent.com/omdsh-dev/dsh-browser/main/packages/browser/bridge-browser/package.json) identifies version 0.0.7 and pins its DSH peers to 0.2.0-rc.2. This checkout's tool packages are 0.1.5-rc.2, and the bridge exports Cordis and Web client entries rather than a Native installation. These declarations do not establish compatibility with RSH; changing version strings alone cannot validate the APIs.

The [upstream extension manifest](https://raw.githubusercontent.com/omdsh-dev/dsh-browser/main/extensions/dsh-browser/manifest.json) requests HTTP/HTTPS host access and installs content scripts across matching frames. Its [tool inventory](https://github.com/omdsh-dev/dsh-browser#core-capabilities) includes mutations and navigation. That scope exceeds this read-only proposal. The repository carries an [MIT license](https://raw.githubusercontent.com/omdsh-dev/dsh-browser/main/LICENSE); any future source reuse needs attribution review. No upstream source or installer is included in this change.

### Integration boundaries

Keep the browser work out of Desktop window management, CLI profile selection, IDE workspace handoff, and the shared lockfile while those integrations are being developed. A local transport must authenticate its peer and reject non-local callers; transport selection and browser grant lifetime still require implementation and verification. An existing Web fetch provider is not a substitute for the grant service.

## Alternatives considered

**Install the upstream bridge unchanged.** Its declared runtime dependencies, mutation tools, and broad extension permissions do not satisfy the RSH read-only scope. No installer is run to test compatibility.

**Reuse URL fetching as tab reading.** URL fetching has no authorized tab identity and cannot enforce revocation of that tab's grant.

**Add a second browser conversation or execution loop.** A separate loop would duplicate Session and approval ownership; results belong in the user's current Harness conversation.

## Acceptance criteria

- A local fixture page returns the expected title, URL, and text without changing the page; credentials and form values are absent.
- Unauthorized sites, revoked grants, changed pages, disconnected peers, and timed-out reads return explicit failures. No stale result is accepted after revocation.
- Click, type, submit, delete, and navigation requests are rejected at execution, not merely hidden in the UI.
- A supported profile composition records source and success/failure in the existing Session and reproduces the tool output in a keyless snapshot.
- The user can inspect connection state and disconnect; subsequent reads fail. Authentication material is absent from Session output.
- Offline tests use local fixture pages without a model request. Model response validation remains separate until usable resources are confirmed.

## Risks

Page text can contain personal data or adversarial instructions even when form fields are excluded. Grant checks must cover page changes during extraction, not just request admission. Browser extension lifecycle and authenticated local transport remain unimplemented; the manifest review is not a working browser connection or an end-to-end compatibility test.
