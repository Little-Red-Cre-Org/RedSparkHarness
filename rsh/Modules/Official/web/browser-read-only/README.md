---
description: "Native tools for revocable reads from explicitly authorized Chrome documents."
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-read-only

English | [中文](README.zh.md)

## Summary

This optional Native package supplies `browserReadOnly` and registers `browser_tabs` and `browser_read` on the existing tool registry. The Chrome extension owns document grants; the application owns approval, model requests and Session persistence. See the [Windows setup guide](../../../../Docs/user/guide/browser-read-only.md).

## Table of Contents

- [Configuration and service](#configuration-and-service)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Configuration and service

The `./native` entry targets Host and requires `tools`. Reading additionally requires the application's existing approval authority and answerer; absence or rejection produces an error result. Defaults are resolved and validated at installation.

| Field | Default | Constraint |
|---|---|---|
| `connectionFile` | Required | Absolute, unused path in a directory private to the OS user. |
| `readTimeoutMs` | 15000 | Integer 100–120000; also bounds authentication. |
| `maxTextChars` | 60000 | Integer 1–100000; UTF-16 characters per read. |
| `maxGrants` | 8 | Integer 1–64. |
| `maxPendingReads` | 4 | Integer 1–32. |

`resolveBrowserConfig(input)` returns the resolved `BrowserReadConfig`. `BrowserReadOnly.open(config)` exclusively creates a discovery file for a random authenticated local pipe. `status()` returns connection state and `BrowserGrant` values (`id`, `url`, `title`). `read(BrowserGrantId, AbortSignal)` returns a `BrowserPage` (`url`, `title`, `text`, `truncated`). Revocation, disconnect, timeout, cancellation or provider shutdown rejects pending reads. Navigation and reload invalidate the extension's document grant. Reauthorization creates a fresh identifier; grants never survive reconnect. `close()` releases sockets and removes only its own discovery file. Concurrent instances must use separate files; a stale file fails activation instead of being overwritten.

The registry owns the two tool contributions and their disposal. Service Definition, pipe Provider and tool Consumer coevolve in this package. No invariant companion is published: grants and pending requests have one authority, and results are checked against the live grant before acceptance. Neither the relay nor the extension writes a Session.

The one-MiB wire limit applies to each message, independent of stream chunk boundaries. The receiver validates the header before allocating one body buffer and writes fragments at their offsets. The popup queues user actions behind in-flight requests and preserves unchanged page controls during polling. Reauthorization replaces the previous grant only after document validation; the grant limit is checked when publishing the new grant.

## Dev Note

`tests/browser.spec.ts` covers admission and grant lifetime. The [recorded browser scenario](../../../../../snapshots/native-headless/browser-read-only/snapshot.yml) exercises the shipped Native profile with a deterministic peer and model, approval, durable tool results and cold reopening. Actual Chrome qualification separately exercises its extension and Native Messaging; a simulated peer alone does not qualify a browser release.

## Model Experience

### Browser tools and source text

#### What the model sees

`browser_tabs` returns only explicitly granted page metadata. `browser_read` accepts one `grant_id`, requests existing conversation approval, and renders bounded text with its title and source URL. The generic tool-result card displays that same text. Successful results, errors and approval decisions use the application's existing Session writer. The model is told to treat page content as untrusted source material and cite its URL. These instructions do not make arbitrary page text trustworthy.

#### Token effect

Two tool schemas are present while the installation is active. Listing adds granted metadata; each read adds the returned text and source fields. `maxTextChars` bounds text characters, not model tokens or provider charges. Errors add their explanation instead of page text.

#### KV Cache effect

The schemas remain stable while this installation is unchanged. Page metadata, content and errors append to the conversation, changing its suffix; installing or removing the tools can invalidate reuse from the changed tool definitions onward. The package makes no cache-hit guarantee.

## Known Limitations and Deferred Work

- The supplied registration script supports Windows Chrome Native Messaging. Its private helper only relays framed JSON between Chrome and the local pipe; it is not an application launcher. Chrome's `activeTab` permission precedes each explicit grant. Authorization applies to the connected Host; conversation approval selects the consuming read. Revocation prevents subsequent reads but does not erase past Session records or model requests.

- Extraction reads rendered text from the top document's first `main`, `article` or main role, otherwise `body`. It excludes forms, buttons, editable regions and hidden text. It does not click, type, navigate, submit forms, read cookies, inspect frames or shadow roots, extract images, OCR or parse PDFs. Dynamic updates within the same document can change a later read. Rendered text can still contain personal information. There is no automatic reconnect or retry; Chrome must remain running. Other browsers and platforms are unqualified. Local software has no subscription requirement; model inference can cost money.
