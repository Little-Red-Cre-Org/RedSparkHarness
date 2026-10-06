---
description: "The sandbox-enforcing ctx.fs backend for deployments and maintainers confining model file mutations to a session workspace."
kind: "package-reference"
---

# @deepseek-ai/dsh-fs-sandbox

English | [中文](README.zh.md)

## Summary

`dsh-fs-sandbox` provides Cordis and Native filesystem entries that confine model writes and edits by each call's sandbox policy while preserving local reads. In `read-only`, it rejects mutations; in `workspace-write`, it permits targets only inside the workspace or platform temporary roots; in `danger-full-access`, it delegates without a path fence. Both entries share the same canonical containment check and local atomic backend. Denied operations return `FS_SANDBOX_DENIED`, which filesystem tools present with the active mode and a same-turn escalation hint.

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

Select this provider instead of `fs-local` when model writes and edits must follow the session's sandbox mode, while reads stay unconfined. The fence applies per call: the tool layer resolves the calling session's mode and workspace root into the same policy the bash runner receives, so the filesystem and shell families never confine to different roots.

### Cordis composition

Load the shared policy service, then this backend, then the tools; the read-before-edit policy plugin stays optional.

```yaml
- name: '@deepseek-ai/dsh-sandbox-policy'
- name: '@deepseek-ai/dsh-fs-sandbox'
  config:
    cwd: /absolute/path/to/workspace
- name: '@deepseek-ai/dsh-tool-fs'
```

The backend's config is unchanged from the local backend's (`cwd` resolution default and `diffBasisMaxBytes` overwrite bound); the [configuration catalog](../../../../Docs/config-catalog.md#deepseek-aidsh-fs-sandbox) is the exhaustive source.

### Native profile composition

The package also exports a Host-only `./native` entry that provides the same `fs` service from `LocalFileSystemBackend` and requires the `sandboxPolicy` service from `dsh-native-sandbox-policy`. When shutdown starts, the Native entry rejects new mutations and waits for admitted writes and edits—including containment checks and backend I/O—to settle before its Host installation stops. Select the Native policy and this provider explicitly; no local-filesystem fallback is installed when either provider is absent.

The `runtime` entry remains the Cordis adapter and still requires `dsh-sandbox-policy`. Optional peer metadata lets Native-only installs omit Cordis, Plugin Host, and the legacy policy package; it does not select a face or guarantee that the Cordis face can load without its host and policy providers.

### How the fence behaves

The effective mode comes from the calling session's override or escalation grant, falling back to the deployment default when neither is in force. `read-only` denies every mutation with the structured `FS_SANDBOX_DENIED`. `workspace-write` allows a mutation only when the target canonicalizes under the workspace root or a platform temp area (`/tmp`, `os.tmpdir()`) — the same writable set the Seatbelt profile grants. `danger-full-access` delegates unfenced.

### Observable success and failures

Reads, listings, and metadata work exactly as with `fs-local`. A denied mutation returns an `FS_SANDBOX_DENIED` error carrying the effective mode; through the tools the model sees `[sandbox: file access denied under <mode> mode]` plus the one-approved-wider retry hint, identical to bash's denials. A session with an approved escalation may retry the same operation at a strictly wider mode for that one call.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the sandbox backend and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The fence is a policy check in trusted code over a model-controlled path — not a kernel boundary. The operations are the seam's own (open, rename); only the target path is untrusted, so canonicalize-then-contain is the complete answer to this surface. Kernel-grade isolation of untrusted code stays `ctx.shell`'s job.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `SandboxedFileSystem`: mode fence on `writeText`/`editText`, `sandboxMode` fact |
| [`src/native.ts`](src/native.ts) | Native Host Provider using the same local backend and required Native policy |
| [`src/policy.ts`](src/policy.ts) | Shared per-call target check used by both provider entries |
| [`src/containment.ts`](src/containment.ts) | Ancestor containment check with lexical fast path and identity-based fallback |

### How a mutation is fenced

Each mutation resolves the per-call policy (`danger-full-access` returns the caller's target untouched; `read-only` throws `FS_SANDBOX_DENIED`), then for `workspace-write` re-canonicalizes the target immediately and requires containment under one of the writable roots derived from the single `writableRoots` function — the same set the Seatbelt profile grants, so the fs fence and the bash runner cannot drift. The fresh target is the one mutated, so a symlink ancestor swapped since the tool resolved it is caught.

### Threat model

The residual resolve-to-syscall TOCTOU is narrowed by re-canonicalizing immediately before the write and is accepted for this threat model; a kernel-tight boundary would need `openat2`-class primitives whose portability cost is not worth it here. A denial is a structured `FsError`, not stderr inference — an in-process fence knows exactly what it refused.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from this backend to the shared policy home and the confinement decisions behind it.

- [Filesystem subsystem](../../../../Docs/subsystems/filesystem.md) — exhaustive provider contract, policy events, and error taxonomy.
- [dsh-fs](../fs/README.md) — the `ctx.fs` contract this backend implements.
- [fs-local](../fs-local/README.md) — the local backend this one extends.
- [sandbox-policy](../../sandbox/sandbox-policy/README.md) — the Cordis per-session policy resolver.
- [native-sandbox-policy](../../sandbox/native-sandbox-policy/README.md) — the Native per-session policy provider.
- [Process sandbox subsystem](../../../../Docs/subsystems/sandbox.md) — modes, per-call policy, and fail-closed errors.
- [Cross-family fs sandbox decision](../../../../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md) — the shared mode fence and its escalation choreography.

-----

<a id="model-experience"></a>
## Model Experience

### Filesystem policy and refusals

#### What the model sees

In Cordis compositions, the policy owner contributes capability-neutral `sandbox:policy` context. In either face, `dsh-tool-fs` renders this backend's `FS_SANDBOX_DENIED` refusals as the `[sandbox: file access denied under <mode> mode]` marker plus the same-turn escalation hint.

#### Token effect

The Cordis current-policy clause adds a small runtime-context message while the sandbox backend is mounted; a denial adds the bounded marker and escalation hint to conversation history. The Native Provider enforces the policy supplied to each mutation call.

#### KV Cache effect

A standing-policy change appends an owner-rendered superseding runtime-context snapshot after retained history; operation results remain append-only.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the sandbox backend is a poor fit or needs special operational care. They are current package constraints, not a general sandbox comparison or a task backlog.

- **A policy fence, not a kernel boundary** — the check is trusted code over a model-controlled path, so the residual resolve-to-syscall TOCTOU is narrowed (by the in-place re-canonicalization) but not eliminated; adversarial host processes are out of scope. Kernel-grade isolation of untrusted code stays `ctx.shell`'s.
- **Fence-vs-runner parity is derived from one owner** — the writable set comes from `writableRoots`, shared with the Seatbelt profile; a runner profile that defines its writable set elsewhere would drift.
- **Requires the policy provider for the selected face** — Cordis uses `ctx.sandboxPolicy`; Native requires the `sandboxPolicy` service. Neither face falls back to an unconfined provider when its policy is missing.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This stateless adapter delegates policy and filesystem relations to their owning seams.
