# Agent Note: Related Session facts are admitted together

Status: implemented

English | [中文](2026-10-04-session-batch-acceptance.zh.md)

## Problem

A human permission choice records sandbox, approval and preset facts. A later synchronous append guard can veto one fact after an earlier fact has already changed the policy.

## Decision

`Session.appendBatch` snapshots and validates every event, guard, surface transition and publication callback before changing the log. Guards see the pre-batch log. Store observers see the complete accepted batch and receive its events in sequence order. Recursive appends remain forbidden during acceptance and publication.

Existing SessionStore publication delivers accepted batch events through its current observer feed. Persistence Consumers remain responsible for durable flush; batch admission does not promise an atomic filesystem transaction or rollback after acceptance. Existing event envelopes and committed format generations remain unchanged. Program-owned tracking and permission Consumers are not included in this foundation batch.

The Session invariant validates prospective batch transitions on a detached trace. Publication applies the accepted transitions to the committed trace. A later dispatch veto abandons the prospective trace; a subsequent append starts from committed state.

## Validation

Owner tests cover later-event veto, recursive append rejection, invalid surface relations, immutable contiguous acceptance and ordered store publication. Downstream permission projection evidence is separate.

## Consequences

Observers can inspect later facts in the same accepted batch. Stateful validation uses a prospective trace, and Session exposes exact accepted-event identity for later policy Consumers. Durability failures after acceptance remain writer failures rather than in-memory rollback.

## Alternatives considered

Sequential append was rejected because a later veto leaves partial policy changes. A second writer or log rollback was rejected because it would change Session ownership and durable history semantics.
