# M4 AI Application Assistant — Integration Status

Last updated: 2026-10-10.

| Boundary | Status | Evidence / next action |
| --- | --- | --- |
| M2 route → M4 gateway → `MappingDraft` | PASS offline | `/assistant/map-fields` integration test returns HTTP 200 and real mapping logic |
| Direct mapping without an API key | PASS offline | Name/email/etc. mapped; semantic fields remain manual |
| M4 → shared LLMProvider | PASS with MockProvider | Prompt/schema and per-field evidence minimization asserted |
| M2 confirmation → application/mapping persistence → history | PASS offline | Seeded fixture API integration test |
| M1 MappingDraft display | PASS local browser, no key | Seeded list → detail → form showed high-confidence direct fields and manual semantic fallback |
| M1 persistence/history | PASS local browser, no key | Confirmed/edited fields saved; success screen, history title/date, and DB mapping record verified |
| M1 failure feedback | PASS for duplicate-save failure | Backend conflict kept the form open and displayed an error; mock fallback remains code-guarded but not browser-tested |
| M3 job extraction | Not changed | Existing suite must remain green; live M3 schema smoke pending key |
| Live DeepSeek form mapping | PASS local sandbox API smoke (2026-10-10) | Real `deepseek-flash` returned complete `experience` and `motivation` drafts with a 2048-token cap; 5/5 fields mapped, and in-memory confirmation/persistence/history returned HTTP 201/200/200. This was not an external employer submission or browser E2E. |
| Live Qwen and M3 extraction | NOT VERIFIED | No live Qwen or M3 extraction call was part of this smoke test. |
| GitHub CI | See Draft PR checks | First PR revision passed all four jobs; latest frontend adapter revision must also pass before review |

No external employer application is sent by this module. M2's in-platform application record is
created only after the user confirms required fields in the UI. The local no-key browser E2E and
any live-provider quality assessment remain separate acceptance evidence; one cannot replace the
other. The M1 profile page/navbar still contain static demo data outside this integration slice.

The 2026-10-10 live smoke used an in-memory database and fictional applicant. The previous
600-token cap produced `finish_reason=length` for `motivation`; after raising it to 2048, both
semantic fields returned `finish_reason=stop` and were marked for user review. The local sandbox
confirmation created only an in-platform test record, which was then found in history. No
external employer form, deployed environment, or real applicant data was exercised.
