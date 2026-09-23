# Agent Note: Native durable request time context

Status: implemented

English | [中文](2026-09-23-native-time-context.zh.md)

## Problem

Native applications need the established clock, elapsed-time, and browser-zone guidance without importing the Cordis Agent pre-step listener or mutating a request outside the durable Session history. The context must remain replayable and its refresh policy must survive Session restore.

## Decision

`@deepseek-ai/dsh-native-time-context` provides a native `timeContext` service without directly importing Cordis. Its `prepare` method takes the Session and exact turn/step plus any proposed user messages that are not logged yet. When due, it returns one `user/message` with the `native-time-context` snapshot source. The application owns append ordering and must append the returned message before deriving the model request. The current manifest and Session dependency still declare Cordis peers under the repository transition policy; removing Cordis from the installed production closure belongs to P5.

The service seeds a per-Session time projection from events already loaded by the Session owner and advances it after each committed append; it does not synchronously read arbitrary Session history. It recognizes a browser zone only from a canonical Host-validated user-RPC source in the open turn. A unique zone is the display zone and model guidance; missing or mixed zones use the configured or process zone only to format the timestamp, and the model is told to ask for clarification. Step 1 elapsed time starts at the latest user message, assistant message, or tool result; later steps start at the latest time-context injection in the current turn.

`dsh-native-headless` consumes the service only when installed. The package adds no Session event type, Agent hook, Cordis adapter, or automatic profile installation. The existing `dsh-time-context` Cordis plugin remains unchanged.

## Alternatives considered

**Adapt the Cordis pre-step plugin:** This would keep native applications dependent on Cordis lifecycle and Session projections for a context that can be derived from existing Session events.

**Insert a request-only message at model dispatch:** This would make model-visible context absent from the Session log and break replay of the request that used it.

**Put a changing clock in the system prompt:** This would mix request-time facts with stable application instructions and make the reading harder to attribute and schedule in history.

## Consequences

Native applications can add replayable clock context without changing the Agent loop or released Session format. Each consumer must append the returned message and owns persistence failures. Browser time-zone authority remains with canonical user-RPC provenance; display fallback does not become user intent. A positive refresh interval can suppress a new reading in a later turn, leaving the prior reading in that request history.

This decision follows the durable context source vocabulary in the [context form note](../feature/2026-08-05-context-form-vocabulary.md), the browser-zone ownership rules in the [schedule time-zone note](../simplification/2026-08-09-explicit-schedule-time-zone.md), and the injection/turn separation in the [request context note](2026-07-24-separate-context-injection-from-turn-execution.md). The [headless composition note](2026-09-22-native-headless-profile-composition.md) records the application integration. The [migration proposal](../../proposed/architecture/2026-09-22-rsh-native-runtime-and-optional-cordis.md) tracks the remaining native migration.

## Verification

Focused tests cover durable source attribution, exact unique-zone formatting, mixed and missing zone policy, fallback display, step elapsed baselines, Session-wide refresh after turn changes, invalid config, and proposed messages. The native headless integration test verifies that the message is appended before the model reads the request.
