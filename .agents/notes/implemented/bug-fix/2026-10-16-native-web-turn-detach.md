# Agent Note: Native Web Turns Survive Page Detach

Status: implemented

English | [中文](2026-10-16-native-web-turn-detach.zh.md)

## Problem

Closing or reloading the native Web page cancelled the running turn, including a turn waiting for tool approval (UX audit N15). The Host aborted the turn when the `session/await` or `session/prompt` long-poll disconnected, and the Client and conversation controller sent `session/cancel` whenever the page lifetime ended. After reopening, the tool row reported an interrupted call with an unknown outcome and the approval card was gone. A turn that settled while nobody awaited it also blocked the next prompt with "Session already has a pending turn".

## Decision

The turn lifetime belongs to the Host. A disconnected settlement waiter only unbinds itself; the turn keeps running and its pending approvals and questions stay pending. A turn that settles without a waiter is retired, and `session/start` admits the next prompt after a settled turn that nobody awaits.

`session/attach { sessionId, lastSeq }` reopens the running turn's follow stream from `lastSeq`, replays its pending human prompt, and returns its `admissionId` (or `null` when no turn runs). The page then uses the existing `native-session/follow`, `session/await`, `session/answer-human`, and `session/cancel` endpoints. A newer attach replaces the older feed, detaches the older page's settlement waiter without cancelling execution, and reclaims a disconnected turn's result for the replacement waiter; an attach superseded while it reads history rejects without rebinding pending prompts. There is no separate recovery state.

The Client sends `session/cancel` only for the caller's explicit turn signal. Client lifetime and the new detach signal stop following and awaiting without cancelling. The conversation controller passes Stop as the turn signal and its page lifetime as the detach signal. Restoring a selected Session attaches; when a turn is running, the controller shows the sending state and Stop and observes frames through the same path as `send()`. Afterwards it re-reads durable history, also when attach finds no turn, because the turn may have settled between the history read and attach.

## Alternatives considered

**Keep the page-bound lifetime and only improve the interrupted-tool message.** Rejected because a reload would still destroy work and pending approvals, which the original DSH GUI kept running.

**A dedicated recovery state machine with its own status endpoint.** Rejected because one attach call that returns the existing admission identity reuses the follow, settlement, answer, and cancel endpoints without new states.

**Keep several followers per turn.** Rejected because one page view per turn is enough; a newer attach replacing the older feed keeps the Host feed ownership unchanged.

## Consequences

A reload or tab close no longer cancels Host work, and a reopened page resumes live output and the pending approval card. A turn whose page never returns runs until completion or until the user stops it from a later page. Tool-error presentation (the rest of N35) is unchanged.

## Verification

Three Host specs in `native.host.spec.ts` pin the contract: a detached prompt keeps its turn running and the next prompt is admitted after it settles; an attach after a disconnect keeps the settlement when the turn settles before the new await; a pending approval is replayed onto an attached feed while the old waiter is detached and an overlapping superseded attach is rejected, and answering it completes the turn. A controller follow spec pins the history refresh when restore finds no active turn. The existing controller and human-control specs cover that `send()` and selection still settle normally.
