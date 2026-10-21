# Agent Note: Native file tools and attachment Providers

Status: implemented

English | [中文](2026-10-05-native-file-tools-and-attachment-providers.zh.md)

## Problem

NativeTools result persistence does not supply filesystem operations or durable image storage. Image tools also need metadata from the selected real Model Provider; advertising image support without consulting that Provider accepts unsupported routes.

## Decision

The [native file tools](../../../../rsh/Modules/Official/fs/tool-fs/src/native.ts) consume the selected Fs and observation policy and register value tools in NativeTools. The [attachment Definition](../../../../rsh/Modules/Official/attachment/attachment/src/native.ts) publishes the same operations used by the [local Provider](../../../../rsh/Modules/Official/attachment/attachment-local/src/native.ts). Shared pure executors preserve text and image output. The Headless sole writer persists tool results and appended input before observer acceptance and the next model request.

Both real HTTP adapters publish native Model services and exact metadata lookup through the shared adapter class. Their native installations capture validated static configuration; Cordis entries retain dynamic settings and their existing authorization and extension registrations. The native entries supply neither a second model directory nor an extension registry. Image reads consult the Session's exact provider and model and refuse absent image metadata.

Prompt contributions retain their registration scope. Rendering selects the consuming agent's visible contributions, including ancestor shadowing and sibling isolation. The Headless consumer renders its actual agent scope and records the assembled system message.

## Alternatives considered

Reusing content-only compatibility tools would omit NativeTools value and presentation metadata. A fabricated model-metadata service would bypass the selected adapter's capabilities. Global prompt registrations would disclose sibling contributions. Each alternative omits an owned relationship required by the real Consumer.

## Consequences

Attachment references and Session event fields do not change. Attachment removal drains accepted image preparations, replacement transforms and cache writes, then reports stream cleanup failures. Model removal cancels admission, closes paused iterators and drains actual adapter operations; a next-call failure retains its request error after closing the underlying iterator, and iterator cleanup failures remain available to Provider close. The installation configuration remains static until replacement.

## Verification

The isolated tree compiles complete file tools, the attachment Provider, both real model Providers and scoped prompt registration. The keyless `read-image-native` scene launches public `dsh` with the real Pi HTTP adapter, checks persisted image bytes against the next model request, and cold-reads the sole JSONL log without mutation. Recorded output and readonly replay both pass; Direct native publication compiles but this scene does not call its HTTP endpoint.

Native and compatibility launchers share the existing checked environment loader through the Host-only `./layers` export. Host loading captures inherited values before parsing both files and validates them before applying values or importing plugins. Each root scope receives the selected snapshot Provider; Client-only loading does not.

The selected async-generator cancellation case holds cleanup after a yielded chunk, verifies both request and Provider close remain pending, preserves the caller abort identity and reports the cleanup failure through close.
