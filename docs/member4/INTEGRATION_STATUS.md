# M4 AI Application Assistant — Integration Status

Date: 2026-09-27.

| Boundary | Status | Evidence / next action |
| --- | --- | --- |
| M2 route → M4 gateway → `MappingDraft` | PASS offline | `/assistant/map-fields` integration test returns HTTP 200 and real mapping logic |
| Direct mapping without an API key | PASS offline | Name/email/etc. mapped; semantic fields remain manual |
| M4 → shared LLMProvider | PASS with MockProvider | Prompt/schema and per-field evidence minimization asserted |
| M2 confirmation → application/mapping persistence → history | PASS offline | Seeded fixture API integration test |
| M1 MappingDraft display | Code integrated, browser PENDING | Page consumes mapping response and shows review level; execute seeded browser E2E |
| M1 persistence feedback | Guard implemented, browser PENDING | No false success on failed save; mock fallback cannot be submitted |
| M3 job extraction | Not changed | Existing suite must remain green; live M3 schema smoke pending key |
| Live Qwen/DeepSeek | REAL_PROVIDER_SMOKE_PENDING | Configure approved key; run minimal authorized smoke only |
| GitHub CI | PENDING | Observe checks on Draft PR; do not mark Ready for Review before green |

No external employer application is sent by this module. M2's in-platform application record is
created only after the user confirms required fields in the UI. The browser E2E and any live-provider
quality assessment remain separate acceptance evidence; local API tests do not replace them.
