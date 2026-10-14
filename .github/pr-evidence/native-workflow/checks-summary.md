# Native workflow checks

Latest implementation source HEAD: `1eb5ae8518df47614a5265da4e0e358dd4a84157`. Initial implementation checkpoint: `18a305983ef18579c86e885ca72abffa78d7755e`. Base: `7c15423eff5569180e3a9024277ab8397b26649e`. This directory is a later evidence-only publication. No full build, test or lint result is relabelled as a run on its evidence commit. [Validation](validation.md) distinguishes the earlier WIP runs, the final-source pre-push check and the runtime capture limits.

| Check | Actual outcome | Evidence |
| --- | --- | --- |
| Full build | Passed on pre-commit WIP; initial missing Node headers were resolved with complete official Node 24.19.0 | [Build](logs/build-final.log.gz) |
| Serial typecheck | Passed after rebuilding generated Host declarations | [Typecheck](logs/typecheck-final.log.gz) |
| Normal push hook at exact source HEAD | Passed; normal push succeeded and remote SHA matched `18a305983e` | [Push](logs/push.log.gz) |
| Serial lint | Passed with an existing unused directive warning in acp-child | [Lint](logs/lint-serial.log.gz) |
| GUI | 416 files passed; 5609 tests passed, 1 skipped | [GUI](logs/gui-final.log.gz) |
| Shared workflow package coverage | 38 tests passed; statements, branches, functions and lines all 100% | [Workflow coverage](logs/workflow-coverage-final.log.gz) |
| All Native application owners plus workflow | 89 behavior tests passed; NativeTranscript thresholds failed: lines 40.27%, branches 23.28%, functions 43.75%, statements 42.1% | [Owner coverage](logs/coverage-all-owners.log.gz) |
| Documentation | 35 passed, 0 failed, 0 skipped | [doc-sync](logs/docsync-final.log.gz) |
| Native graph, constraints, dependency policy, export JSDoc | Passed | [Native graph](logs/native-deps-final.log.gz), [constraints](logs/constraints-last.log.gz), [dependencies](logs/deps-last.log.gz), [JSDoc](logs/jsdoc-last.log.gz) |
| Official pinned-browser replay | Failed: 91 files failed, 14 passed, 1 skipped; 31 tests failed, 34 passed, 318 skipped. Missing pinned Chromium explains many failures; not every failure is classified | [Official replay](logs/web-official.log.gz) |
| Separate system-Chromium Cordis replay | Workflow file passed 3 tests; same invocation's Native file failed at Model menu | [Browser result](logs/browser-system-retry.log.gz) |
| Separate real Native CLI/Host capture | 1 completed run, 1 ordinary workflow tool card, 0 member links; no submitted task or model request | [Capture result](logs/native-qa-prompt.log.gz), [capture source](qa-native.capture-source.txt) |
| Hygiene | 35 UI i18n findings, 5 archify optional imports, and missing tool-subagent manifest edge reproduced on clean exact main; implementation dependency declaration findings were corrected | [Branch hygiene](logs/hygiene.log.gz), [main i18n](logs/main-i18n.log.gz), [main optional imports](logs/main-optional.log.gz), [main Cordis config](logs/main-cordis.log.gz) |
| Duplication | 95 clones on branch and exact main, no new workflow clone | [Main duplication](logs/main-duplication.log.gz) |

The Native Model menu timeout is **not reproduced on exact main** and remains unclassified. It does not prove a passing full Native e2e case or a baseline defect. Official fixed Chromium download was not retried after the previously reported rejection. System Chromium evidence does not replace official replay.

[PR #228](https://github.com/Little-Red-Cre-Org/RedSparkHarness/pull/228) remains unmerged. At source handoff, [CI run 38540167147](https://github.com/Little-Red-Cre-Org/RedSparkHarness/actions/runs/38540167147) had both required SPH jobs in progress. Those observations are historical, not a current green CI assertion. Independent CR, current CI verification and merge belong to the parent agent.

## P2 repair checks

The original table preserves historical results; none was rerun or relabelled for the repair. Independent CR's two P2 findings are fixed in `1eb5ae8518df47614a5265da4e0e358dd4a84157`, with the following additional focused evidence:

| Check | Outcome | Evidence |
| --- | --- | --- |
| Negative control with exact transcript source from `18a305983e` | 3 expected failures, 1 pass | [Negative control](logs/p2-negative.log.gz) |
| Affected Native application and workflow owners on repaired working copy | 14 files, 92 tests passed | [Owners](logs/p2-owners.log.gz) |
| Focused regression on immutable repair commit `1eb5ae8518df47614a5265da4e0e358dd4a84157` | 4 tests passed | [Exact-source run](logs/p2-exact-source.log.gz) |
| Repair commit hooks | Passed | [Commit](logs/p2-commit.log.gz) |
| Relevant documentation checks | Export JSDoc, links, wrap, note format/classification and translation pairing passed | [JSDoc](logs/p2-jsdoc.log.gz), [links](logs/p2-links.log.gz), [wrap](logs/p2-wrap.log.gz), [note format](logs/p2-note-format.log.gz), [note classification](logs/p2-note-classification.log.gz), [pairing](logs/p2-pairing.log.gz) |

Normal pre-push typecheck is required for the evidence publication. There is no new full build, official browser replay, screenshot or complete GUI claim on the repair/evidence commits.

## Exact-source Native recapture

A focused TSC build plus the workflow and Native application Client bundles passed on exact HEAD `943d452f42ef24084819045b19bf535ab5cf06cc`, product-source equivalent to `1eb5ae8518df47614a5265da4e0e358dd4a84157`. The real CLI/Host restored-history QA then succeeded and generated three new Native PNGs, including a collapsed-sidebar, expanded-workflow narrow view with a visible member. Its initial extra collapse-button action timed out after automatic responsive collapse; that failure is preserved and the capture-only navigation was corrected. No UI/interface change, task/model request, exhaustive rerun or official pinned-browser pass is claimed. [Capture manifest](current-head-capture.json) supplies exact source, commands, paths and hashes; [runtime images](evidence.md#current-exact-source-native-recapture) show the result.
