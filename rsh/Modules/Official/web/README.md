---
description: "Package map for the web access capability family: the search/fetch service, its provider backends, and the model-facing tools that consume them."
kind: "package-group"
---

# web/ — web access capability family

English | [中文](README.zh.md)

## Summary

The `web/` packages let models search the public web, fetch HTTP(S) pages, or read text from explicitly authorized browser documents. Deployments can choose Exa, Perplexity, or DeepSeek for search and anonymous HTTP(S) access for fetch. The separate Native browser capability uses browser-owned grants and conversation approval. Availability and limits depend on the provider; interactive page operations are outside this family.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Seven packages cover public web access and authorized browser reads; the subsystem reference owns the vocabulary and contracts.

| Package | Role | ctx key |
|---|---|---|
| [`web/`](web/README.md) | Search/fetch service: search and fetch URLs through interchangeable backends, one selection and error policy | `ctx.web` |
| [`web-search-exa/`](web-search-exa/README.md) | Searches the web through Exa | registers on `ctx.web` |
| [`web-search-perplexity/`](web-search-perplexity/README.md) | Searches the web through Perplexity | registers on `ctx.web` |
| [`web-search-deepseek/`](web-search-deepseek/README.md) | Searches the web through DeepSeek native search | registers on `ctx.web` |
| [`web-fetch-http/`](web-fetch-http/README.md) | Fetches public HTTP(S) pages anonymously | registers on `ctx.web` |
| [`tool-web/`](tool-web/README.md) | Exposes `web_search` and `web_fetch` to the model | registers on `ctx.tools` |
| [`browser-read-only/`](browser-read-only/README.md) | Native service, local pipe provider and consumers for authorized page reads | `browserReadOnly`, registers on Native `tools` |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem reference for the shared vocabulary, then the design decision behind the single provider-selection service.

- [Web subsystem](../../../Docs/subsystems/web.md) — the search/fetch requests and results, provider availability, `WebError`, and public-address enforcement.
- [Web capability seam decision](../../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) — why search and fetch share one provider-selection service.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
