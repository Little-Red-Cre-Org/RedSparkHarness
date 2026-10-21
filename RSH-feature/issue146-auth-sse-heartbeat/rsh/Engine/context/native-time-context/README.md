---
description: "Native Provider for durable request-time context, for native profile authors and maintainers."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-time-context

English | [中文](README.zh.md)

## Summary

`dsh-native-time-context` provides the native `timeContext` service without directly importing Cordis. A consumer asks it to prepare one request reading; when due, the service returns a source-attributed user message that the consumer appends to the Session before deriving the model request. The reading includes the current time, the current turn's browser-zone policy, and elapsed time. The package does not install itself into an Agent loop or change the Session event format. A consumer must call `seed()` before preparation and `record()` for each committed event; an unseeded Session is rejected.

## Table of Contents

- [Use this package](#use-this-package)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Install the Provider in a native profile when its application must present durable clock context to a model. The consumer calls `prepare({ session, turn, step, requestMessages })` before model dispatch, appends a returned message as `user/message`, and only then derives the request. `requestMessages` supplies new user messages that the application has not appended yet; it participates in browser-zone selection but does not replace Session persistence.

```json
{
  "id": "time-context",
  "plugin": "@deepseek-ai/dsh-native-time-context",
  "scope": "root",
  "config": {
    "timeZone": "Asia/Shanghai",
    "refreshIntervalMs": 30000
  }
}
```

| Field | Default | Meaning |
|---|---|---|
| `timeZone` | Node process zone resolved at Provider activation | Fallback display zone when the open turn has no unique browser zone |
| `refreshIntervalMs` | `0` | Minimum elapsed milliseconds between readings in one Session; `0` adds a reading at every request preparation |

Configuration is resolved before activation. Unknown fields, invalid zones, negative intervals, and intervals that are not safe integers fail profile activation. The accepted fields are declared by [`Config`](src/index.ts).

### Zone selection and refresh

The service trusts only Host-canonicalized browser zones carried by user-RPC messages in the open turn. One unique zone formats the timestamp and is named in the model instruction. Missing or mixed browser zones use the configured or process zone only to format the clock; the model instruction still asks the user to clarify otherwise-unqualified dates and times. A fallback never claims to be the user's zone.

The consumer seeds the time projection from already-loaded Session events and advances it after every committed append. The refresh interval uses the latest `native-time-context` injection in that projection, so a restored Session keeps its schedule. Step 1 measures elapsed time from the latest preceding user message, assistant message, or tool result. Later steps measure from the latest time-context injection in that turn. A missing baseline says `unavailable`; a backwards wall clock clamps elapsed time to zero.

Each returned user message contains a timestamp with numeric UTC offset and IANA zone, the browser-zone policy, and elapsed whole seconds.

```markdown
Time sampled while preparing turn <turn>, step <step>: <timestamp>
Browser time zone for this request: <resolved-zone-or-clarification-policy>
Elapsed since the preceding <model-visible-message-or-step-context>: <duration-or-unavailable>.
```

The message source is `{ kind: 'plugin', plugin: 'native-time-context', form: 'snapshot' }`. The consumer must append it before the next model request so Session replay and request history both contain it.

<a id="dev-note"></a>
## Dev Note

No invariant companion is published: the service has one projection over consumer-supplied Session events, with no independent state to compare against it.

## Model Experience

Indirectly, through the consuming application, which appends each due reading as a durable user message before model dispatch and retains it in later requests until compaction.

#### KV Cache effect

The reading is appended after the existing request history. It does not change the reusable prefix before that new message.

## Known Limitations and Deferred Work

- The Provider does not add a browser-zone RPC field; a Host must supply canonical user-RPC provenance for the service to use it.
- The service returns a message but does not append it. Each application owns ordering, persistence, and error handling around that append.
- A positive interval can suppress a reading in a new turn; the current request still receives the durable prior reading in its history.
- This package and its Session dependency still declare Cordis peers under the repository transition policy; P5 owns removing Cordis from the native-only production closure.
