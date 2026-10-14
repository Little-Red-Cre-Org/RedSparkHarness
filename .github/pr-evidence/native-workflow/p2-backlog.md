# Native workflow P2 backlog

Independent CR confirmed the two P2 findings below. Both are repaired in `1eb5ae8518df47614a5265da4e0e358dd4a84157` and await independent rereview; this ledger does not assert that review found no P0/P1 issues. The parent agent owns integration, remaining classification and merge.

| Confirmed P2 | Repair | Evidence |
| --- | --- | --- |
| WF-P2-01: session-scope runs reorder around a turn tool card and collide with legal turn 0 | Ordered consecutive display groups have distinct identities; a session-scope run does not set owning currentTurn or render as turn 0 | Scope A → turn 1 tool card → scope B → legal turn 0 remains in exact event order. New test fails on exact old transcript source, passes after repair. |
| WF-P2-02: equal sequence/turn keys reuse disclosure state across Sessions | Workflow panel key includes Session id and run-start sequence | Running manually collapsed and completed manually expanded runs both reset to their fact-derived defaults when switching Session. Both negative controls fail before repair and pass after it. |

[Negative control](logs/p2-negative.log.gz), [92 owning regressions](logs/p2-owners.log.gz), and [four exact-source regressions](logs/p2-exact-source.log.gz) retain the outcomes.

## Unclassified validation limits

| Item | Status | Evidence and next decision |
| --- | --- | --- |
| NativeTranscript coverage shortfall | Open, severity unclassified; not established baseline | All owning behavior tests pass but existing per-file thresholds fail. Compare exact main before classifying debt or regression; [coverage](logs/coverage-all-owners.log.gz). No thresholds were lowered. |
| Native full-flow Model menu timeout | Open, severity unclassified; exact-main reproduction not run | Branch WIP under system Chromium repeatedly detached the Model menu button before the workflow block. Preserve the failure; [browser log](logs/browser-system-retry.log.gz). |
| 35 UI i18n findings | Reproduced on exact main, outside M3 implementation changes | [Main result](logs/main-i18n.log.gz). No speculative source repair is included. |
| 5 archify optional imports | Reproduced on exact main, outside frontend scope | [Main result](logs/main-optional.log.gz). Route to the owning agent. |
| Missing tool-subagent dependency in bundle/rsh | Reproduced on exact main, outside M3 implementation changes | [Main result](logs/main-cordis.log.gz). No manifest repair outside the authorized UI package is included. |
| 95 existing clones | Same count on exact main and branch | [Main result](logs/main-duplication.log.gz). No new workflow clone was reported. |

Official pinned-browser availability is an environment blocker, not a confirmed P2 product finding. Native child-session navigation is intentionally deferred pending the logical directory/address/parentAvailable contract; seed/fork metadata does not replace that contract. No new functionality or Core repair is authorized by this ledger.
