# Agent Note: Shared native storage and domain adapters

Status: implemented

English | [中文](2026-10-04-native-storage-domain-adapters.zh.md)

## Problem

Native workspace archive needs the existing domain-backed global record. A second settings namespace, JSON sidecar or copied domain implementation would split its durable authority. The shared backend and domain runtime depend on Cordis context dispatch even though their media and write ordering are framework independent.

## Decision

Storage publishes the same named backend registry through a native service and a pure backend vocabulary leaf. The selected backend Provider publishes generic readiness tied to that exact registry after registration. The domain Provider requires readiness, rejects a foreign registry and resolves every configured backend reference before admitting Consumers. Backend replacement does not require a JSON-specific dependency on the domain Consumer; several backends require an explicit combined readiness publisher.

JSON compatibility and native adapters export one backend class with the existing layouts, atomic publication, configured root and version stamps. The shared domain facility uses the same spec validation, unit handles, authoritative maps and single write chain. Framework adapters supply a narrow durable-change dispatcher and diagnostic reporter. Pure event payloads have one declaration; compatibility event augmentation is separate.

Close stops admission and owns every accepted open until it either registers its domain or releases its unit. Domains and JSON backends attempt all accepted cleanup before reporting failures. Failed opens preserve both their original failure and a unit cleanup failure; facility disposal also reports those actual unit cleanup failures, without treating load failures as cleanup failures. Backend durability remains the commit point: memory changes and notifications follow it, while synchronous observer failure cannot roll back the written value.

The compatibility catalog retains inherited public facility methods after extraction into the shared implementation.

The backend vocabulary is a Host-only public source export; native dependency checks inspect its real Host source, reject Cordis references and still reject missing published source.

## Consequences

Core native source and public declarations import no Engine or Cordis execution authority. There is no new path, archive schema, filesystem deletion operation or alternative store. Native workspace is a subsequent Consumer of these services and retains its unique existing v2 global archive record; these infrastructure proofs do not establish product archive UI or complete P4/P5.

Native diagnostics use the Host console; compatibility retains its context logger. Accepted filesystem work drains rather than being abandoned on cancellation. A stopped facility cannot be reused for new opens. Compatibility entry points remain explicit adapters, and native activation does not silently mount them.

## Alternatives considered

A JSON-specific readiness requirement would couple the domain Consumer to one replaceable Provider. Waiting for backend registration by incidental row order would race Consumer activation. Copying JSON or domain state machines would create competing publication and recovery semantics. A private archive store would conflict with the existing workspace global record. Closing only already registered domains would leak a unit whose accepted load finished during unload.

## Verification

Compatibility backend, registry and domain tests retain 69 existing passing cases. Native Host tests prove JSON durable write order and unchanged cold-open bytes, unknown-route activation refusal, accepted-load shutdown drain and failed-unit cleanup reporting to both the caller and Host shutdown, post-commit observer failure containment, replacement backend readiness and foreign-registry refusal. Owner compilation, source lint and public JSDoc checks pass. Installed product composition and workspace archive Consumers remain separate verification obligations.
