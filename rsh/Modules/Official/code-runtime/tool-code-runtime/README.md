---
description: "Expose bounded TypeScript or Python execution as a reversible native tool using the profile-selected code runtime."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-code-runtime

English | [中文](README.zh.md)

## Summary

`dsh-tool-code-runtime` adds `run_code` to a native profile's tool registry. The selected code runtime executes a TypeScript or Python program and returns its bounded logs, JSON value, or program failure. Removing this module removes code-tool admission and cancels and drains its in-flight calls. The application records one ordinary tool result; installing a code runtime alone does not expose the tool.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

The `./native` entry accepts `maxParallelSubCalls` (default `10`, positive safe integer) and `sdkPrompt` (default `false`, boolean). It requires `tools`, `codeRuntime`, and `fs`, and optionally reads `sandboxPolicy` and `promptSections`. Enabling `sdkPrompt` requires a prompt Provider and installs the reversible `tools:sdk` section in the Consumer's scope. The profile chooses these Providers independently. The selected runtime language determines the code schema and SDK declarations; Python instructions describe plain JSON arguments, static TypedDict declarations, `asyncio.gather` and `print`, while unsupported languages reject installation. Duplicate names fail and scoped visibility, parameter validation, cancellation, and disposal use the ordinary tool registry.

A file policy requires a sandbox-enforcing code runtime unless the selected policy is explicitly `danger-full-access`. A `process-sandbox` runtime requires an explicit policy. Before each confined execution, the Session workspace must equal the policy's configured workspace; a mismatch rejects before entering the Provider. The runtime owns resource limits and execution containment; this module never substitutes another Provider or widens its policy.

The tool registers a value contribution. The registry validates the transport result before rendering its text and retains a detached canonical result for program consumers; a malformed runtime result rejects with INVALID_TOOL_OUTPUT. Before each run, the Consumer queries the Agent's visible standard tool schemas and installs their functions under `tools`, excluding `run_code`. Each binding uses native ordered dispatch and returns the tool's standard value. Tool failures reject inside the program as `ToolCallError` with `toolName`. A visible presentation-only contribution rejects SDK lookup before runtime entry. The Consumer closes and drains dispatch after every Provider outcome, including exceptions; Session append failures reject the outer invocation.

The composite forwards successful nested image presentations and explicit sourced contexts after its outer tool result. These inputs remain outside canonical program values. A Provider-reported program error retains accumulated contexts but suppresses the terminal marker; a successful outer result forwards a nested conclusion after dispatch drains.

<a id="model-experience"></a>
## Model Experience

### run_code

#### What the model sees

The tool executes an async TypeScript or Python function body supplied in required `code`, with a required `description` summarizing its action. The description must contain non-whitespace text; undeclared fields, including `program`, reject with `INVALID_ARGS` before runtime entry. The Provider receives `code` as its internal `program` request. The canonical transport output contains ordered `logs` and optional `result`, mapped from the Provider completion value. Model text joins those logs with the completion: strings stay verbatim, other JSON roots use the shared formatted renderer, and an empty output is stated explicitly. A failure includes its kind, message and captured logs; its canonical output retains the diagnostic under `error`. Program failures retain `NativeCodeRuntimeError` metadata and a `CODE_RUNTIME_*` code. The consuming application logs both arguments, the selected schema and result in the authoritative Session.

#### Token effect

The schema adds a fixed request cost. With `sdkPrompt`, the application records usage instructions and visible argument/result declarations in its system message before model entry. The declarations exclude `run_code`, follow the consuming Agent's restrictions, and reject presentation-only tools. Program source and bounded result text remain in Session history and can enter subsequent requests.

#### KV Cache effect

Installing or removing the contribution changes the selected tool-schema prefix. The registry's `native` mode hides this transport and omits its SDK section; `ptc` exposes only the transport and puts the run_code-only rule before business declarations; `both` keeps direct business schemas and the SDK section.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This consumer accepts TypeScript and Python Providers and rejects other languages at activation. SDK instructions describe `code`, `description` and canonical JSON results; the default omits the section for compositions owning their instructions separately. A thrown Provider or dispatch persistence failure rejects without a composite outcome.
- Program return, timeout and module removal drain admitted binding bodies and their settle records before the outer invocation completes. Cancellation does not undo completed external effects. The Provider remains responsible for stopping its execution substrate.

No invariant companion is published because the contribution has no durable observation independent of the application's Session result.

<a id="dev-note"></a>
### Dev Note

None.
