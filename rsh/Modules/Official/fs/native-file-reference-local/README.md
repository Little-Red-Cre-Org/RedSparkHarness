---
description: "Native Host provider for path-only workspace file discovery through the selected filesystem service."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-file-reference-local

English | [中文](README.zh.md)

## Summary

`dsh-native-file-reference-local` provides Native file-reference candidates through the selected `fs` service. It scopes discovery to the exact active Agent and Session owner, exposes paths only, and contributes stable model guidance only when `read` exists in that Agent scope and the Session allowlist does not exclude it. It does not read candidate contents or access the host filesystem directly.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Install this Native Host Provider beside the selected filesystem Provider, active-session registry, tool registry, and prompt-section registry. Its `dsh.native` declaration requires those four services and provides `fileReferences`; it does not install or select a filesystem backend.

`fileReferences.list(agent, session, query, signal)` accepts only the exact Agent and Session held by one active-session owner. It returns deterministically ranked workspace-relative paths and directories, without reading file contents. The selected `fs` service performs directory listings, metadata checks, canonical resolution, and containment checks, so a different filesystem backend keeps its own namespace.

The provider installs FILE_REFERENCE_PROMPT only when `read` exists in the Agent scope's modelSchemas and, when supplied, the Session `allowedTools` includes it. Native Headless passes that allowlist as a prompt constraint; model request schemas are still selected after active-owner attachment. A user-selected path remains ordinary message text; the model must call its effective read tool before using file contents.

The per-owner index is bounded by `maxEntries` and defaults to the shared exclusion and result-limit constants. A `tool/result` event marks that owner's index stale. Detach cancels admitted queries, drains filesystem reads, and releases the Session event listener; provider shutdown drains every remaining owner.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/native.ts`](src/native.ts) | Native Host Provider, exact-owner lookup, prompt registration, and per-owner disposal |
| [`../../../../Engine/context/file-reference/src/native.ts`](../../../../Engine/context/file-reference/src/native.ts) | Cordis-free `NativeFileReferenceOperations` declaration |
| [`../../../../Engine/context/file-reference/src/search-core.ts`](../../../../Engine/context/file-reference/src/search-core.ts) | Shared bounded traversal and deterministic ranking |
| [`../../../../Engine/context/file-reference/src/prompt.ts`](../../../../Engine/context/file-reference/src/prompt.ts) | Stable model guidance shared with the Cordis provider |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [File-reference contract](../../../../Engine/context/file-reference/README.md) — candidate shape, grammar, and the Native service declaration.
- [Filesystem group](../README.md) — selected `fs` providers and model-facing tools.
- [Filesystem subsystem](../../../../Docs/subsystems/filesystem.md) — filesystem target identity, metadata, and containment semantics.
- [Native file-reference decision](../../../../../.agents/notes/implemented/architecture/2026-10-09-native-file-reference-provider.md) — shared search ownership and lifecycle rationale.

-----

<a id="model-experience"></a>
## Model Experience

### File-reference guidance

#### What the model sees

When the addressed Agent has an effective `read` tool, the provider adds this stable system-prompt section:

##### File-reference instruction

```markdown
Tokens prefixed with @ are workspace paths the user explicitly referenced, relative to the workspace root. A trailing slash marks a directory: list it when its contents matter. Anything else is a file: use the read tool when its contents are needed, and do not claim to have inspected it before reading. @"..." quotes a path containing spaces.
```

#### Token effect

The guidance adds one stable prompt section while `read` is available. Candidate discovery adds no prompt content, and the provider never reads or attaches file contents.

#### KV Cache effect

The stable section joins the system-prompt prefix when `read` is available; changes to candidate queries and index state do not change that prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current package constraints.

- **Namespace follows the selected filesystem** — candidates match the `fs` provider's namespace; a model-facing `read` tool backed by another namespace needs a matching provider.
- **Bounded advisory index** — excluded directories and entries beyond `maxEntries` are not offered, and `.gitignore` files do not affect traversal.

**Runtime invariant:** No invariant companion is published because the per-owner search index is a disposable advisory cache, not a separate durable relation; the selected `fs` and `activeSessions` services remain authoritative for filesystem results and live owner identity.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
