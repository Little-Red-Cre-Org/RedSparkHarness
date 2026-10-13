---
description: "Provide scoped Native request-context Providers whose messages and state are accepted by the owning Program."
kind: "package-reference"
---

# @deepseek-ai/dsh-request-context

English | [中文](README.zh.md)

## Summary

The Native request-context Provider supplies a scope-aware registry for durable model-request context. It prepares every visible Provider before offering detached messages to the consuming Program's single Session acceptance path. Provider state commits only after that Program accepts and flushes the request.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>

## Use this package

Install the Provider in a Native profile when application and Provider packages register durable context for model requests.

### When to choose it

Choose this Provider when the consuming application supplies an exact active Session owner and owns final admission, Session appends, and flush. Root and delegated Programs use the same Headless request path. When there are no visible Providers, the application still runs its normal acceptance path.

### Minimal Native profile installation

Add the Provider to the profile's installation list. It accepts no configuration:

```json
{
  "formatVersion": 1,
  "installations": [
    { "id": "request-context", "plugin": "@deepseek-ai/dsh-request-context", "scope": "root" }
  ]
}
```

The Provider publishes `requestContexts`; applications and other Providers obtain its declaration from [`dsh-request-context-definition`](../request-context-definition/README.md).

<a id="understand-the-implementation"></a>

## Understand the implementation

Visible Providers prepare concurrently in ascending `order`, then provider id order. Each returns detached messages and candidate state; the registry does not write the Session. The application supplies an acceptance callback that performs its final synchronous checks, appends through its existing writer, and flushes. Only an `accepted` result commits prepared Provider state. A rejected result leaves that state uncommitted; preparation, acceptance, and flush failures reject the request.

The request includes exact visibility from the model or PTC execution snapshots. `includes()` matches the captured registration disposer identity, so a schema with the same name does not make a replaced registration visible. Each `register()` call returns a callable disposer for that exact provider; its `isVisible(scope)` check is true only while the registration is the nearest visible provider with the same id, and false after replacement, removal, or registry disposal.

<a id="further-exploration"></a>

## Further Exploration

- [request-context subsystem](../../../Docs/subsystems/request-context.md)
- [Cordis-free request-context Definition](../request-context-definition/README.md)
- [Native Headless](../../core/native-headless/README.md)
- [Native tools](../../core/native-tools/README.md)
- [Request-context acceptance decision](../../../../.agents/notes/implemented/architecture/2026-10-13-native-request-context-acceptance.md)

<a id="model-experience"></a>

## Model Experience

Indirectly, through the consuming Program: accepted Provider messages are appended and flushed to the Session before the model request is derived. This makes those messages part of reconstructable model history.

#### KV Cache effect

The accepted messages extend the request prefix before model dispatch.

## Known Limitations and Deferred Work

- The Provider supplies a registry; it does not install request-context contributors or an application that owns request acceptance.
- The service cannot operate without a consuming Program that supplies the exact active Session owner and its durable accept callback.
- No invariant companion is published because the Provider has no independent view of whether the consuming Program flushed the owner's Session.

<a id="dev-note"></a>

### Dev Note

None.
