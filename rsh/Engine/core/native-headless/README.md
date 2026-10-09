---
description: "Native Session execution for explicit filesystem and durable Session profiles."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-headless

English | [中文](README.zh.md)

## Summary

`dsh-native-headless` supplies one application to a native `dsh --profile` composition. It sends a user prompt to a selected model, executes workspace-confined UTF-8 file reads and writes, optionally runs TypeScript in a profile-selected worker runtime, records model-visible messages and tool results in a released Session log, and settles its owned writer before returning. A native profile must also install filesystem, observation-policy, Session-persistence, model, model-execution, and native Agent Providers.

## Table of Contents

- [Configuration](#configuration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Configuration

Delegated invocations retain the selected sandbox policy and cannot expand permissions through approvals. Required approval requests record asked and decided facts with policy never and outcome rejected; root requests still use the selected approval answerer. Interrupted transient children repair their turn through the existing owner so accepted-event observers and the durable log receive the same cancellation closers.

Continuation observations expose immutable deployment defaults in the exact authorizing workspace. Module Providers reconstruct durable child route and composition independently of those per-activation budgets; the Program retains residency, pending input and the only writer.

The optional `agentInstructions` Provider prepares workspace instructions before each admitted model request. The application records its returned context as `user/message` before dispatch; stored source facts govern resume reconciliation and accepted filesystem results govern nested discovery.

The `./native` entry requires an absolute existing directory in `cwd`, nonempty `provider`, `model`, and `systemPrompt` strings, and an optional positive `maxSteps` (default `4`). Unknown fields fail profile activation. The application accepts a prompt or `--resume <session-id> [prompt]`; each invocation admits one root input through the same Agent execution owner. Resume refuses a changed workspace or system prompt rather than silently sending history from another profile. Its fixed schema exposes `read_file` and `write_file`; an installed `codeRuntime` adds `run_code`, which accepts `{ "program": string }` and records the runtime's bounded JSON result as its tool outcome. A program failure becomes a `NativeCodeRuntimeError` tool result with a `CODE_RUNTIME_*` error code. Optional `tools` and `promptSections` services add reversible schemas and system text, optional `sandboxPolicy` supplies the current Session policy to fixed writes and `run_code`, and optional `approval` applies its policy before `write_file` or a protected contribution runs. The process-sandbox Provider confines code using that Session policy under `read-only` or `workspace-write` and rejects `danger-full-access`; when the policy restricts the Session, builtin and PTC code Consumers reject non-process Providers. Writes use the filesystem observation policy, and paths outside `cwd` fail with `FS_SANDBOX_DENIED`.

The optional allowedTools list filters builtin and registry schemas in each request and rejects calls outside that list. Prompt sections receive detached names from that same emitted schema snapshot; the assembled system prompt is persisted by the existing Session writer and checked on resume and fork.

The application flushes the Session JSONL log after each model-visible input, assistant response, and tool outcome. With `timeContext`, it appends the returned source-attributed clock message before deriving each model request. With `approval`, it durably appends `native-approval/asked` before invoking answerers, then durably appends the matching `native-approval/decided` before executing an allowed operation; an un-aborted non-grant becomes an `APPROVAL_*` result error. Cancellation preserves the borrowed signal reason after the decision audit flush; audit or cleanup failures remain errors. Each Session uses one child-scope native Agent derived from its identity. Turns run inside its explicit initiator boundary, and the Program releases the identity after its accepted work drains. On interruption it records partial assistant output and repairs any outstanding tool result before closing the turn. The model Provider must supply the native `model` service and the streaming protocol from `dsh-llm`.

Before each dispatch, the existing Session writer records the prepared model generation's declared capacity in `request/context`. Route or capacity changes replace that recorded context; missing capacity removes the prior value. No separate catalog lookup or Session format generation is introduced.

The [model-execution Provider](../native-model-execution/README.md) assembles and records each streamed assistant event. The application retains turn and tool ownership.

The application consumes `NativeSessionPersistenceOperations` from `dsh-session-persistence/native`; JSONL is one replaceable Provider. Each turn owns only its selected Session handle and awaits its durability and close. The application does not close or instantiate the persistence service. Changing Provider type ownership does not change model input or logged events.

Registered tools use the registry's model transport selection and exact Agent scope. Tool-owned events append through the same Session writer; concurrent append callbacks serialize persistence. The application accepts the final result, including presentation metadata, before notifying result observers, then appends sourced additional messages before another model request. After each recorded tool result, including fixed tools and failures, it asks the registry's settlement policies for contexts and appends them before the tool's own messages. A successful tool conclusion ends the turn only after every call in the current batch settles. Cancellation prevents a removed contribution's late successful result from being accepted.

The validated `builtinTools` boolean defaults to `true`. Setting it to `false` removes both fixed file schemas and the built-in `{program}` code tool, and dispatches only registry contributions. An opt-in PTC profile selects this value explicitly so its registry-owned `run_code` is the sole transport. Prompt sections receive the exact requesting Agent scope before their rendered text enters the persisted system message.

`sessionExecution` routes child turns and continuations through the same executor. `activeSessions` publishes the exact current Agent, Session and writer; Consumers retain that owner to keep a root resident, or append through idle maintenance without starting a model turn. After asynchronous model and instruction preparation, the Program runs admission commit checks, then synchronously removes exact selected inbox inputs and appends the step and model-visible input events; stale inputs are canceled alone and other pending messages remain queued. Resume and forks retain historical preset selection; preset removal cancels and drains its exact leases. An `AbortError` counts as expected cancellation only when its `cause` is the exact reason of an aborted signal; execution and cleanup failures remain errors.

The Program lists continuation candidates from its selected persistence corpus. It limits paths to the initiating Session's workspace, traverses ordinary Session parents, and checks each direct-parent edge and subagent delegation depth before inspecting a subagent endpoint. An unreadable intermediate yields a diagnostic for its candidate without hiding healthy sibling paths. The existing Agent registry supplies resident status without loading a cold child.

`rootExecution` exposes branded immutable routes, maintenance, execution, [exact root cancellation](../native-session-execution/README.md#execution-ownership), settlement, closed-turn forks and optional recoverable deletion. Exact active root owners also provide the Program-bound turn interruption described in [Session execution ownership](../native-session-execution/README.md#execution-ownership). Dynamic `workspaceRoutes` requires an explicit positive `maxRoutes` and nonempty absolute `allowedRoots`; selection validates the existing Workspace directory against the same filesystem and sandbox policy. Workspace records and global archive ids use the shared v2 storage domain. Deletion refuses busy writers and mismatched routes; it never cancels a task to delete its log. Application disposal attempts every execution and retained epoch close, waits for all of them, and aggregates failures after identity and preset cleanup.

One-shot teardown attempts writer closure even when an active-owner observer rejects, preserving execution and cleanup failures together. Agent admission owns borrowed preset leases before lifecycle announcement; failed or cancelled announcement releases them. Resident children persist that selected preset in their creation header and validate restored facts before module preparation.

With `modelSelection` selected, root steps capture durable intent before header construction. The executor resolves actual Provider defaults and dispatch together; their controls supply the persisted header and the model request. Route changes add a persisted model-change notice; delegated invocations keep their explicit configuration.

Root `prepareMessage` takes priority over `message`. Preparation runs under the existing execution owner after effective next-model selection and before inbox admission. It returns identified input without access to the Session writer; rejection or cancellation admits no user input.

Root cancellation closes and drains an already retained epoch even when the initial turn fails or the settlement signal is already aborted. Execution and epoch-cleanup failures are reported together; the original execution failure remains observable.

## Dev Note

No invariant companion is published: the application has no independent in-process observation of its own state. Session persistence and filesystem Providers retain their own validation.

Continuation input to a busy recipient uses its actual active owner as soon as that owner attaches. A queued idle fallback and live inbox admission claim the message once; selecting the live owner cancels and drains the still-queued fallback. Admission failures preserve their original causes.

## Model Experience

### System prompt

#### What the model sees

The model receives the configured `systemPrompt` followed by registered prompt sections before the user message.

##### Profile prompt

```markdown
<configured systemPrompt>
```

#### Token effect

System text is sent on each step, and retained messages add request tokens on later steps and resume.

#### KV Cache effect

An unchanged prompt prefix can reuse a provider cache; a changed configuration or prompt section changes it from its first differing token.

### Tool operations

#### What the model sees

The model receives fixed `read_file` and `write_file` schemas, `run_code` when `codeRuntime` is installed, plus the mode-selected schemas in the optional `tools` registry. File content, bounded code results, fixed-tool errors, and registered-tool results become one tool-result message before the next request.

#### Token effect

Schemas are sent on each step and tool results remain in later-step and resumed requests.

#### KV Cache effect

Adding, removing, or changing an operation schema changes the request prefix from its first differing token.

### Time context

#### What the model sees

When `timeContext` is installed and its refresh interval is due, the application appends one source-attributed user message with the current time, the open turn's browser-zone policy, and elapsed time before sending the request.

#### Token effect

The reading is retained in later-step and resumed requests until compaction shadows it; a positive refresh interval reduces how often new readings are appended.

#### KV Cache effect

The reading is appended after existing history and does not change the reusable prefix before it.

## Known Limitations and Deferred Work

- Fixed file tools, `run_code`, and registered tools run serially. This package does not implement the SDK protocol or Web UI; the native SDK and Web compositions provide those interfaces.
- Native model Providers and broader capability adapters live in separate packages.
- This composition imports the Cordis-free `./native` Session and persistence entries and creates no Cordis Context. Their packages retain Cordis adapters for compatibility, with Cordis as an optional peer dependency.

Other native Programs reuse resolveNativeHeadlessConfig and createNativeHeadlessApplication without providing another application launcher. Programs with mandatory Session ownership pass the selected execution and active ownership services explicitly.
