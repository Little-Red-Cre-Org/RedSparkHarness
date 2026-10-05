# Agent Note: Native Web Session transport

Status: implemented

English | [中文](2026-10-05-native-web-session-core.zh.md)

## Problem

Web Session transport needs the selected executor without acquiring a separate Agent loop or writer.

## Decision

The browser Session Consumer uses the authenticated Connection route registry. Its Host Program assembles the shared native executor without replacing the Web application's launch service. Explicit selected Session execution and active ownership services prevent transport adapters from acquiring another writer.

Prompt replies describe settled turns, not premature acceptance. One pending browser prompt per Session rejects competing input. Separate bounded control admission preserves cancellation when ordinary callbacks occupy every slot. History uses the selected live owner or an explicitly closed durable read handle and rejects an over-limit body.

## Consequences

The shared Client Session implementation is a peer, including native event validation and the format constant. No duplicate-safe dependency exception is added. Verification covers the real authenticated HTTP carrier, durable create/resume/history and cancellation while ordinary admission is full. Full product UI, incremental following and policy Consumers remain separate P4 work.

## Alternatives considered

Copying the compatibility controller introduces Cordis dependencies and separate lifecycle ownership; the Program uses shared execution and independent transport admission instead.
