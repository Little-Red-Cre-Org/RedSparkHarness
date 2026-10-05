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

Programs may supply `prepareMessage` instead of `message` for root input admission. The callback receives the next durable model selection and composed cancellation while the original Agent holds execution and its Session writer; preparation completes before inbox append. Rejection admits no input or model request. Delegated turns do not expose this callback.

The optional `agentInstructions` Provider prepares workspace instructions before each admitted model request. The application records its returned context as `user/message` before dispatch; stored source facts govern resume reconciliation and accepted filesystem results govern nested discovery.

The `./native` entry requires an absolute existing directory in `cwd`, nonempty `provider`, `model`, and `systemPrompt` strings, and an optional positive `maxSteps` (default `4`). Unknown fields fail profile activation. The application accepts a prompt or `--resume <session-id> [prompt]`; each invocation admits one root input through the same Agent execution owner. Resume refuses a changed workspace or system prompt rather than silently sending history from another profile. Its fixed schema exposes `read_file` and `write_file`; an installed `codeRuntime` adds `run_code`, which accepts `{ "program": string }` and records the runtime's bounded JSON result as its tool outcome. A program failure becomes a `NativeCodeRuntimeError` tool result with a `CODE_RUNTIME_*` error code. Optional `tools` and `promptSections` services add reversible schemas and system text, optional `sandboxPolicy` supplies the current Session policy to fixed writes, and optional `approval` applies its policy before `write_file` or a protected contribution runs. Writes use the filesystem observation policy, and paths outside `cwd` fail with `FS_SANDBOX_DENIED`.

The application flushes the Session JSONL log after each model-visible input, assistant response, and tool outcome. With `timeContext`, it appends the returned source-attributed clock message before deriving each model request. With `approval`, it durably appends `native-approval/asked` before invoking answerers, then durably appends the matching `native-approval/decided` before executing an allowed operation; a non-grant becomes an `APPROVAL_*` result error. Each Session uses one child-scope native Agent derived from its identity. Turns run inside its explicit initiator boundary, and the Program releases the identity after its accepted work drains. On interruption it records partial assistant output and repairs any outstanding tool result before closing the turn. The model Provider must supply the native `model` service and the streaming protocol from `dsh-llm`.

The [model-execution Provider](../native-model-execution/README.md) assembles and records each streamed assistant event. The application retains turn and tool ownership.

The application consumes `NativeSessionPersistenceOperations` from `dsh-session-persistence/native`; JSONL is one replaceable Provider. Each turn owns only its selected Session handle and awaits its durability and close. The application does not close or instantiate the persistence service. Changing Provider type ownership does not change model input or logged events.

Registered tools use the registry's model transport selection and exact Agent scope. Tool-owned events append through the same Session writer; concurrent append callbacks serialize persistence. The application accepts the final result, including presentation metadata, before notifying result observers, then appends sourced additional messages before another model request. A successful tool conclusion ends the turn only after every call in the current batch settles. Cancellation prevents a removed contribution's late successful result from being accepted.

The validated `builtinTools` boolean defaults to `true`. Setting it to `false` removes both fixed file schemas and the built-in `{program}` code tool, and dispatches only registry contributions. An opt-in PTC profile selects this value explicitly so its registry-owned `run_code` is the sole transport. Prompt sections receive the exact requesting Agent scope before their rendered text enters the persisted system message.

`sessionExecution` routes child turns and continuations through the same executor. `activeSessions` publishes the exact current Agent, Session and writer; Consumers retain that owner to keep a root resident, or append through idle maintenance without starting a model turn. Pending messages are durable inbox events, and step admission persists their exact claims before deriving model input. Resume and forks retain historical preset selection; preset removal cancels and drains its exact leases.

`rootExecution` exposes branded immutable routes, maintenance, execution, settlement, closed-turn forks and optional recoverable deletion. Dynamic `workspaceRoutes` requires an explicit positive `maxRoutes` and nonempty absolute `allowedRoots`; selection validates the existing Workspace directory against the same filesystem and sandbox policy. Workspace records and global archive ids use the shared v2 storage domain. Deletion refuses busy writers and mismatched routes; it never cancels a task to delete its log. Application disposal attempts every execution and retained epoch close, waits for all of them, and aggregates failures after identity and preset cleanup.

One-shot teardown attempts writer closure even when an active-owner observer rejects, preserving execution and cleanup failures together. Agent admission owns borrowed preset leases before lifecycle announcement; failed or cancelled announcement releases them. Resident children persist that selected preset in their creation header and validate restored facts before module preparation.

With `modelSelection` selected, root steps capture durable intent before header construction. The executor resolves actual Provider defaults and dispatch together; their controls supply the persisted header and the model request. Route changes add a persisted model-change notice; delegated invocations keep their explicit configuration.

Root `prepareMessage` takes priority over `message`. Preparation runs under the existing execution owner after effective next-model selection and before inbox admission. It returns identified input without access to the Session writer; rejection or cancellation admits no user input.

Root cancellation closes and drains an already retained epoch even when the initial turn fails or the settlement signal is already aborted. Execution and epoch-cleanup failures are reported together; the original execution failure remains observable.

## Dev Note

No invariant companion is published: the application has no independent in-process observation of its own state. Session persistence and filesystem Providers retain their own validation.

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

- Fixed file tools, `run_code`, and registered tools run serially; SDK protocol and Web UI remain absent.
- Native model Providers and broader capability adapters live in separate packages.
- Session and persistence packages still carry Cordis dependencies, although this composition creates no Cordis Context.

Other native Programs reuse resolveNativeHeadlessConfig and createNativeHeadlessApplication without providing another application launcher. Programs with mandatory Session ownership pass the selected execution and active ownership services explicitly.
