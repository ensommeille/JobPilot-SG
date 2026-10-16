# Agile and contribution evidence index (15 October 2026)

Purpose: point to existing records before the final report is written. A source's existence does not independently prove that every planned Scrum ceremony occurred. Do not backdate new artifacts or infer test-first/TDD or pair programming from green tests.

## Sources inspected

| Source | What it can support | Boundary |
|---|---|---|
| [`product-backlog.md`](product-backlog.md) | Baseline SB-01–SB-12 priorities and suggested sprints | A plan, not proof of completion |
| [`docs/evidence/sprint-1/`](../docs/evidence/sprint-1/README.md) and [PR #7](https://github.com/ensommeille/JobPilot-SG/pull/7) | Sprint 1 CI screenshots and repository integration evidence | Does not by itself show planning/review/retro discussion |
| [GitHub Issues](https://github.com/ensommeille/JobPilot-SG/issues?q=is%3Aissue) | Publicly visible #11, #13, #24, #27 closed and #26 open at this snapshot | Only five public issues were returned; none had a milestone. Do not equate issue counts with hours burned |
| [Merged pull requests](https://github.com/ensommeille/JobPilot-SG/pulls?q=is%3Apr+is%3Amerged) | Dated integration/review trail, including #17–#23, #25 and #28 | A merged PR does not prove a sprint ceremony or individual hours |
| [Main CI run for PR #28 merge](https://github.com/ensommeille/JobPilot-SG/actions/runs/38601502966) | `f9d76eb` main run completed successfully on 14 October | Does not verify this later unpushed branch or actual external deployment |
| [Canvas updated schedule](https://canvas.nus.edu.sg/courses/100094/discussion_topics/485346) and [Team 9 presentation slot](https://canvas.nus.edu.sg/courses/100094/discussion_topics/485368) | Final report 1 November 2026 at 23:59; Team 9 presentation 27 October, 9:30–10:15 am Singapore time | Team-slot announcement title says 26 October while its schedule/Zoom body says 27 October; recheck for later changes |
| [Canvas final report template folder](https://canvas.nus.edu.sg/courses/100094/files/folder/Project%20Report%20Template%20for%20Practice%20Module) | Named official DOCX template is listed, last modified 1 September; its eight-page online preview matches the headings and substantive instructions in the same-named local copy | Local and Canvas bytes were not compared; no final-report assignment was visible in the course assignment list on 15 October |
| `SWE5006_Progress_Report_-_Sprint_3_-_Team_9_v6(1).docx` in the user's WeChat drag folder | A team-authored Sprint 3 report with objectives, retrospective, burndown figure, approximate effort and contribution summary | Local temporary copy; obtain the submitted Canvas version and member confirmation before treating it as authoritative |
| [`docs/member2/`](../docs/member2/README.md), [`docs/member3/`](../docs/member3/README.md), [`docs/member4/`](../docs/member4/INTEGRATION_STATUS.md) | Module-specific handoffs, contracts and dated verification claims | Re-run important claims for the final revision; these are not automatically team review minutes |

The Sprint 3 report names 28 September–11 October as its reporting period but dates the report 10 October. It reports M1 PR #18, M4 PR #17, M5 PRs #19/#20, M2 database support and M3 live-source validation; it lists approximately 116 hours total and a retrospective. Those are **claims in the report**, not reconstructed timesheets or independent confirmation. It also calls sandbox application saving an end-to-end flow while explicitly saying real InternSG postings lacked forms and no real employer submission occurred. Later PRs #23, #25 and #28 changed some of these gaps; do not silently rewrite the historical Sprint 3 report.

## Evidence map for final report

| Question | Evidence available now | Still needed |
|---|---|---|
| What was planned? | Baseline backlog, proposal, development document, Sprint 3 report objectives | Actual Sprint 1–4 plans and any changed backlog from Canvas/team board |
| What shipped and when? | Git commits/merged PR dates, CI run history, module handoffs | Team review of ownership and scope-change reasons |
| What did the team demonstrate at reviews? | Sprint 3 report describes sandbox integration | Review agenda, demo notes/screenshots, lecturer or stakeholder feedback with dates |
| What did retrospectives change? | Sprint 3 report contains went-well/problem/next items | Sprint 1, 2 and 4 retro records and whether actions were completed |
| How did remaining work change? | Issue/PR timestamps can support a **retrospective reconstruction** | Original daily estimates, added/removed scope and reopened work; do not call issue closure a measured hour burndown |
| Who contributed? | PR history, module reports, Sprint 3 contribution summary | Member-verified contributions including review, testing, integration and design work outside commits |
| Which defects were resolved? | Issues #24/#27; PR #23 Favorites, #25 availability/session handling, #28 integration | Defect-to-test links. Issue #26 remains open; this unmerged branch adds its missing frontend audit gate, but the team must review/verify before closure |
| Was TDD or pair programming practiced? | No direct red-green-refactor or pairing log found in inspected repository sources | Only claim these practices if dated actual evidence is supplied |

## Specific materials to request from the team

1. Submitted fortnightly progress reports, especially Sprints 1, 2 and 4, plus the submitted Sprint 3 version rather than a temporary draft copy.
2. Sprint plans, review notes, retrospectives, backlog change log and original burndown inputs (estimates/remaining work by date, reopened or added scope).
3. Any lecturer feedback, meeting notes, design-review decisions or user-test observations with source and date.
4. Each member's confirmation of actual contributions, use-case and pattern ownership, effort and non-code work. The official report template requires at least one use case and one design problem per member; do not invent assignments or peer rankings.
5. The final report assignment/upload link when Canvas publishes it, and any later schedule change. The 31 August announcement supersedes the local briefing deck's tentative dates.

If these items remain unavailable, state “not supplied/verified” in the final report. A dated PR timeline may be included as a **retrospective reconstruction**, with its source and limitation stated explicitly.
