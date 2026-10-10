---
description: "Native DeepSeek Platform browser sign-in and safe profile or wallet reads for Host account surfaces."
kind: "package-reference"
---

# @deepseek-ai/dsh-deepseek-account

English | [中文](README.zh.md)

## Summary

Native Host account surfaces can sign in to DeepSeek Platform and read a sanitized profile and CNY or USD wallet balances. Browser sign-in stores a grant in the credential Provider and requires the optional authorization service. The package sends grants only to the configured HTTPS Platform origin.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Select this package in a native Host composition with `credentials`; include `authorization` to expose browser sign-in. The `llm-pi-ai` accounts service consumes its profile, balance, and sign-out operations when this Provider is present.

### Configure the Platform origin

The native plugin input accepts one optional field:

| Field | Default | Meaning |
|---|---|---|
| `platformOrigin` | `https://platform.deepseek.com` | HTTPS origin for Platform sign-in, profile, balance, and logout requests |

### Account records

The Provider stores its grant at `deepseek-account/default` and its device id at `deepseek-account/device`. A grant is usable only when its issuer matches `platformOrigin`; a malformed or mismatched grant appears signed out.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The authorization flow owns a loopback callback and commits its validated grant through the selected credential Provider. Profile and balance requests project Platform responses into UI-safe values and remove a still-current grant after an authenticated rejection; they return successful data only while the same grant remains stored.

| File | Role |
|---|---|
| [`src/native.ts`](src/native.ts) | Native service, record ownership, and browser authorization lifecycle |
| [`src/protocol.ts`](src/protocol.ts) | Bounded Platform requests and fixed browser destinations |
| [`src/details.ts`](src/details.ts) | Profile and wallet parsing |
| — | No runtime invariant companion is published; grant matching and response parsing stay within the Provider's request path and expose no independently observed mutable relationship. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Credential store](../credentials/README.md) — durable records and their Provider operations.
- [Authorization](../authorization/README.md) — native flow registration, cancellation, and commit behavior.
- [Pi-ai accounts](../../llm/llm-pi-ai/README.md) — the native account list, balance, and sign-out consumer.

-----

<a id="model-experience"></a>
## Model Experience

None, as Platform account operations do not add model input or change model requests.

#### KV Cache effect

No invalidation; account state does not enter a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits describe the account operations this package provides.

- **Profile and balance need Platform access** — network or response failures return `failed`; they never become an empty profile or a zero balance.
- **Remote logout is best effort** — sign-out drains active browser authorization, removes only the matching grant it read, then starts a bounded Platform logout request; provider disposal waits for pending logout requests.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
