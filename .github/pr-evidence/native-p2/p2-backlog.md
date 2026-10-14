# Native UI P2 backlog

Audit base: main `e9a8e82bc7a8f935ef9cbf0396f269c5ce9756c2` after #223. The concentrated repair uses `codex/native-p2-20261014`; final independent CR, required SPH on both platforms and merge belong to the main agent.

| Item | Confirmed problem and minimal owner fix | Current evidence/status |
| --- | --- | --- |
| P2-01 | Optional Settings absence blocks onboarding. Return the existing empty description and real limits; preserve read errors and refuse writes/open-document. | Implemented. Key Host/validated-client regression passes; absence fails before the repair. |
| P2-02 | Loaded model/effort rows ignore the no-Session lock after catalog retry. Use the shared row lock and retain the open menu while loading. | Implemented. Existing Native control scenario passes; both rows are enabled before the repair. |
| P2-03 | Empty text pages lose line separators. Join by line counts; a zero-line EOF adds no separator. | Implemented. Blank pages and zero-line EOF pass; original source loses both leading blank lines. |
| P2-04 | Reopening a cached collapsed directory shows old entries. Reuse loadDirectory and its generation guard on every expansion. | Implemented. The reopened directory lists fresh entries; original source performs only one list call. |
| P2-05 | Unrelated/same-version observations reset preview pagination. Filter the selected absolute path and observed version, including removal. | Implemented. Both observations retain pages; a changed version or removal refreshes them. |
| P2-06 | Old loadMore success/failure contaminates a same-path refresh. Bind pagination to the existing preview read's AbortController. | Implemented. Both delayed completion branches pass after refresh; original source appends obsolete text and displays an obsolete alert. |
| P2-07 | Generic Next is clipped at settled 375px with the automatic 56px rail. Wrap the narrow footer and keep its action group aligned. | Reproduced on the fresh main build in a real Native CLI screenshot; Fixed and verified in the pre-merge P2 real Native replay; the after-image shows Next fully visible. Merged replay did not start (0xC000026B). |
| P2-08 | #219 describes two HTTP cases and two exclusions. | Corrected to one direct registry case plus one authenticated HTTP case, and application Client exclusion plus Host inclusion. Historical counts are preserved. |
| P2-09 | #222 private checkedTarget comment promises the fresh target. | Corrected to return the original target after confinement/identity validation and reject changed identity as FS_STALE_VERSION. Runtime policy is unchanged. |

Four important scenarios were changed or added. Before the repair, all four fail on the expected contracts. After the repair, all four pass; the three owner files record 15 passed and one unrelated failure. That older HTTP lifecycle fixture fails because foreign-program does not declare optional requestContexts; a narrow rerun reproduces the same error in the earlier checkout whose Git tree exactly equals this merged base (tree `32adfb836fdc37a7af7ba1890b688be3525bdbf7`). This comparison covers that one failure only.

The first normal build found a missing routableProviders field in the new model catalog fixture; the field is supplied without a production fallback. The corrected normal build passes. Original-base 61-gate coverage completed in two segments (53 passed / 8 failed / 0 skipped); normal lint passed. Main 29ab1728b0c50365a33d77cb1b12ae406efe551c was merged forward normally. Merged install/build and four affected scenarios pass. Doc-sync ended 6 passed / 29 failed, predominantly process startup failures; merged export JSDoc/later documentation and real replay remain incomplete. The user authorized publication first for remote continuation. Final independent CR and required SPH remain pending.

Older handoff candidates outside these confirmed items remain pending latest-main review. No blanket claim is made that all original P2 candidates or broad-suite failures are resolved.

Original local review base: `29ab1728b0c50365a33d77cb1b12ae406efe551c`. Detailed results and unedited screenshot provenance are in `checks.json`, `evidence.md` and `screenshots.json`.

## Cloud continuation

The branch merges main `fa546a8641c5784963d92fdf32045fbda1bb1ec5` normally. Source commit `12e2c7367b6977d3b7186a21083483349739ef9e` resolves two further P2 regressions confirmed during independent review:

| Item | Owner repair | Evidence |
| --- | --- | --- |
| P2-10 | Preserve observations during pending reads and compare the actual returned identity/version before publishing. | Initial P2 probe fails and prior source passes; current tests cover matching versions, newer versions and removal. |
| P2-11 | Track loaded HTML dependency identities and versions; refresh on change/removal, retry restored assets and retire dependencies when the HTML document changes. | Initial P2 probe fails and prior source passes; current owner scenario covers dependency version changes, unrelated/matching observations, removal/recreation and retirement. |

The owning Native Session details Agent Note and bilingual package README document these semantics. Normal build/lint pass, doc-sync passes all 35 gates, and the final three owner files pass 20/20 without retries or timeout changes. A preceding owner run records one HTTP lifecycle test timeout at 5000ms during concurrent lint; it is retained without an exact-base classification. Locked-Chromium replay remains blocked by download policy. Independent system-Chromium Native QA passes 1/1 and contributes separately identified screenshots; it does not replace the official replay. See the cloud continuation object in [checks.json](checks.json) and [browser result](cloud-browser-result.json).
