# Optional private AI discovery batches

This supplements deterministic discovery; it does not replace saved profile facts,
verify eligibility or submit applications. Only explicitly saved education,
experience and skills plus the requested filters enter the model input. Known
personal identifiers, email addresses, phone numbers and URLs are redacted. PDF
bytes, extracted-but-unconfirmed suggestions, nationality and contact fields are
not sent. Education dates are retained without converting dates into experience
years or inventing graduation dates.

`GET /jobs/ai-recommendations/candidates` is a free authenticated preview. It ranks
at most 1,000 active, unexpired, enabled public-source postings using original
profile terms and corpus-weighted lexical overlap, without the existing closed
skill vocabulary gate. It returns up to 20 candidates and a truncation flag.

`POST /jobs/ai-recommendations` requires JSON `confirmed: true`. Optional `job_ids`
select 1–5 distinct eligible postings; any unavailable ID rejects the request.
Otherwise at most five preview-ranked postings are selected. A single structured
batch call assesses every selected job, quotes its JD and cites the corresponding
saved profile field for support. Missing evidence stays unknown. Unsupported
claims about explicit years or degree level are conservatively downgraded.
Citation checks establish source correspondence, not semantic correctness;
`result.requires_review` remains true even when technical processing succeeds.

`GET /ai-recommendations/{run_id}` reads only the caller's record. All three routes
use normal session authentication and no-store responses, including errors.
Responses distinguish running, succeeded and failed, mock/live execution, actual
provider/model and usage. Ranks are not percentages or hiring predictions.

Migration `20261023_0008` adds one private cache table. The unique user/input hash
includes the minimized profile, filters, sorted job IDs/JD contents and pipeline
versions. Selection order does not cause a second charge. The committed claim
precedes model access; an owner token and lease fence publication. A provider or
validation failure is durably cached. Expired claims become failed, never an
automatic paid retry. This version exposes no force/retry operation.

The production factory requires `AI_RECOMMENDATIONS_LIVE_ENABLED=true` separately
from extraction/form switches. It reuses `app.llm`, disables thinking and transport
retries, caps output at 12,000 tokens and the logical call at 60 seconds. The normal
default model for this new consumer is `deepseek-flash`; the other consumers'
defaults are unchanged. A local acceptance helper may override `get_ai_runtime`
with an explicitly configured provider factory without putting a secret in files.
No model call occurs merely by importing this package or fetching candidates.

## v2 evidence and priority correction

The first local live batch exposed a material semantic failure: a role requiring
an undergraduate graduating in 2028 ranked first despite a saved undergraduate
course range ending in 2026. Its summary called it a strong fit while its own
warning raised the condition. The original provider output and cached run remain
unchanged. `ai-recommendation-v2-actionable-evidence` creates a distinct cache key.

V2 puts explicit education/work-condition conflicts after roles without those
known concerns, preserving the model's relative order within each group. The
specific undergraduate timing comparison also lowers priority when a recorded
course range differs from the requested graduation cohort, but keeps the outcome
unknown: a course range does not prove graduation, and a master's start date does
not prove its final year. Only explicit conflicting graduation/completion dates
become gaps. This is advice to verify a condition, not an employer eligibility
decision. Ordinary missing evidence remains unknown and does not trigger this rule.

Summaries are generated from validated outcomes rather than retaining conflicting
model prose. Narrow checks reject a Git-only quote for Git AND GitHub, and a
Python-only quote for Python AND an ML-framework condition. A quoted teacher/student
distillation experiment can support the generic OR-listed model-distillation
alternative, while specialized video duties and additional AND conditions remain
unproven. These bounded patterns do not establish arbitrary AND/OR correctness.
The prompt additionally prioritizes complete applicant-condition coverage,
including start date, duration and onsite requirements, ahead of a few representative
duties. Coverage and semantic quality still require review of the actual output.

The second live batch was correctly rejected because several responsibility and
work-constraint rows omitted the required `outcome`. V3 (`ai-recommendation-v3-complete-rows`)
keeps the schema strict, adds a complete seven-key example for every category,
and retains failed v2 attempts unchanged under their original cache identity.
It also checks both displayed branches of the narrow Python/framework condition
and does not treat a Python quote as proof of a separate interest requirement.
These prompt corrections improve instructions; they do not guarantee valid or
semantically complete output from a future model call.
