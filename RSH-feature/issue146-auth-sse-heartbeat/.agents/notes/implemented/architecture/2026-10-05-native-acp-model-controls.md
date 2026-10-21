# Agent Note: Native ACP model controls

Status: implemented

English | [中文](2026-10-05-native-acp-model-controls.zh.md)

## Problem

ACP controllers need standard model and reasoning configuration without creating transport-local selection storage or another Session writer.

## Decision

New and resumed Sessions project configuration options from the selected native model directory and durable selection Provider. Model values encode the complete provider/model identity; reasoning values come from the resolved model. The current durable route remains visible when absent from discovery.

Configuration requests serialize in receive order. A request received during a prompt waits for that prompt's settlement; the next prompt cannot overtake pending configuration. Caller cancellation rejects waiting requests without abandoning the preceding owned operation. Session close and transport EOF cancel and drain controls before releasing the executor.

The shared executor admits exclusive idle maintenance. The selection Provider reads the current durable revision there, validates the exact route, compares that revision and flushes its selection event. The ACP carrier publishes the complete resulting configuration and retains no second selected state.

## Alternatives considered

An ACP-local selection cache would diverge after cold restore or another Program's durable change. Writing intent during model execution would bypass the existing maintenance owner. Hardcoded model lists would prevent Provider-driven configuration.

## Consequences

Explicit native ACP profiles support model and reasoning controls while legacy defaults remain unchanged. Missing directory or selection Providers expose no options and reject mutations. MCP mounts and permission interaction remain separate capabilities.
