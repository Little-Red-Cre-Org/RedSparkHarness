# Agent Note: Native Session append guards

Status: implemented

English | [中文](2026-10-03-native-session-append-guards.zh.md)

## Problem

A persistent terminal can retain the confinement mode selected at creation after its parent turn finishes. Rejecting later terminal operations cannot prevent a sandbox mode event from entering that parent's Session while the process still exists.

## Decision

Session owns synchronous pre-append guards over validated immutable events. Rejection leaves the log and next sequence unchanged; exact registrations have independent disposers and guard reentrancy is refused. Restore loads recorded events without dispatching these checks.

Resource Providers can hold these registrations until their owned activity settles. Policy and Program integration are separate consumers and are not included in this Session foundation batch.

## Consequences

Direct Session.append and appendBatch use the same registered checks. The guard does not own persistence or add a second writer. Sandbox, Terminal and Program consumers remain separate integration work.

## Alternatives considered

Checking after policy.record is too late because the Session has accepted the mode event. Guarding only setSandboxMode leaves direct and Program-mediated append paths unchecked. A Session-owned pre-append registration covers all writers without duplicating the publication route.

## Validation

The existing owner-local append-guard tests cover unchanged logs and sequence, exact duplicate-registration removal and recursive append rejection. Terminal lifecycle and product acceptance remain separate.
