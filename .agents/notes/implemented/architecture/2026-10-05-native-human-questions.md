# Agent Note: Native human questions and pending broker

Status: implemented

English | [中文](2026-10-05-native-human-questions.zh.md)

## Problem

Native tools need the existing human question vocabulary and root-only permission without loading Cordis. The profile loader selects one native installer per package, so the question Definition and a separately selectable pending-question Provider cannot share a single manifest entry.

## Decision

`user-questions/protocol` owns the unchanged question and answer values. Compatibility event declarations and `UserQuestionService` forward to these values; the shared error derives from the canonical errors package. The native registry authenticates the exact registered Agent and writer-available active Session. Current delegated invocations are rejected; historical child lineage does not prevent a restored root invocation from asking.

The registry selects scoped answerers through an awaited waterfall. Delegation preserves ancestor cancellation. Removing an answerer, releasing the Agent or stopping the Host cancels and drains accepted work, including downstream presentations. The broker retains the original Agent and a random branded request identity, validates submitted JSON, and rejects mismatched, duplicate or late answers. Removing the last subscribed recipient cancels its pending presentation.

The separate `user-question-broker` package publishes the same broker installer for native profiles. It contains no second registry, lock or request map. The tool Consumer registers a canonical value tool, preserving compact JSON answers and ordinary error recording through the Program's existing sole writer. No Session event or generation changes are introduced.

## Alternatives considered

A second broker implementation would split pending ownership. Changing the CLI loader to choose arbitrary secondary entries would widen application installation semantics for a local Provider requirement. A separate Provider manifest reusing the existing implementation supplies the necessary selection.

## Consequences

One NativeHost/Headless case covers accepted answers, invalid choices, the next model request, durable result recording, delegating-answerer removal and late-answer refusal using JSONL storage. One keyless Session snapshot launches the shipped `native-headless` template through the built `dsh` CLI with an isolated question-only composition and scripted broker recipient; it preserves the question schema, rendered answer and subsequent model context. Both use a controlled model, not a product model Provider. The capability group supplies no SDK, ACP, terminal or Web answering transport; those consumers remain separate publication work. The public profile resolver and built entry checks validate installer selection independently from that controlled model case.
