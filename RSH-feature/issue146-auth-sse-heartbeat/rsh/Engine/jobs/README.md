---
description: "The jobs group map: background-job control — the registry contract, process-local storage, and the model-facing job tools — for users and maintainers navigating the group."
kind: "package-group"
---

# jobs/ — background-job capability family

English | [中文](README.zh.md)

## Summary

The jobs group covers model-facing controls for background work. In a Cordis composition, `jobs` defines the registry, `jobs-local` stores owned work, and `tool-jobs` supplies controls and in-session completion notices. Native compositions use the separate [Agent-owned job registry](../core/native-jobs/README.md) and `native-tool-jobs` controls. Both fence access to the owning Agent; the native one-shot application currently releases its Agent at turn end and does not deliver idle completion notices.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`jobs`](jobs/README.md) | Defines the background-job contract: ids, ownership, lifecycle, and completion listeners | `ctx.jobs` |
| [`jobs-local`](jobs-local/README.md) | Runs and stores jobs in this process, fenced per owner | registers on `ctx.jobs` |
| [`tool-jobs`](tool-jobs/README.md) | Lets the model read, list, and kill jobs and delivers completion notices | registers on `ctx.tools` |
| [`native-tool-jobs`](native-tool-jobs/README.md) | Exposes Agent-owned native jobs to the selected native tool registry | native `tools` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Background task runtime subsystem](../../Docs/subsystems/jobs.md) — the job types, snapshot fields, and the `ctx.jobs` API.
- [Generic long-running tool runtime Agent Note](../../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md) — the design behind the background-job runtime.
- [job-registry seam Agent Note](../../../.agents/notes/archived/architecture/2026-07-26-job-registry-seam.md) — the owner-fenced registry contract and its rationale.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
