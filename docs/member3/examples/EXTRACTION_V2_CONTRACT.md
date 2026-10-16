# Extraction semantics v2

This is an additive, versioned extraction contract. It does not certify model
accuracy. Every successful run remains `needs_review`. An offline scripted
fixture is still `execution_mode: mock`; changing a schema does not make it live.

## Version and history

New service calls default to `job-extraction-v2` and
`job-extraction-prompt-v2`. The original `JobExtractionSchema` is the unchanged
v1 contract; `JobExtractionSchemaV2` is separate. `ExtractionResult` accepts both
and rejects a version/payload or schema/prompt mismatch. An operator can explicitly
select v1 for legacy fixture replay, but v1 output is never silently promoted to
v2. Historical JSON is not rewritten.

Runs remain append-only JSON records in `job_extraction_runs`; no physical table
migration is needed. Schema, prompt, quality version and extraction configuration
enter the pipeline fingerprint, so a new v2 run cannot reuse v1 cached evidence.
API history must remain readable with both versions in the same job history.

The v2 default and operator live runtime cap output at 8,000 tokens per call.
The richer output can exceed the earlier 2,500/4,000 limits; truncation remains a
failed extraction, never an accepted partial result. A token ceiling is not a
fixed price guarantee. Live runtime disables transport/schema repair retries and
still requires explicit paid-call opt-in; offline tests do not use live endpoints.

The executable v2 JSON schema and provider request are `job_extraction.schema.json`
and `provider_request.json`. The v1 exports are retained as
`job_extraction.v1.schema.json` and `provider_request.v1.json`.

## Typed facts

Every key is required. Unknown information is `null` or `[]`, not an inferred
value. All non-null facts retain supporting source quotes.

- `summary`: a text fact. It must preserve explicit main/conditional duty
  distinctions; a quote being present does not validate the summary's meaning.
- `responsibilities`: text facts with `priority` (`primary`, `secondary`,
  `conditional`, `unspecified`) and `condition` (a source-backed text fact or null).
  Priority is unspecified without explicit source support. Conditional duties
  require the condition; attaching a condition to an unconditional priority is
  rejected.
- `requirement_groups`: each group has the complete source statement `value`,
  `evidence`, `importance` (`required`, `preferred`, `unspecified`), `operator`
  (`all_of`, `any_of`, `unspecified`) and nonempty `requirements` atoms.
  An atom has `kind` (`skill`, `language`, `trait`, `interest`, `qualification`),
  `value`, `evidence` and optional `qualifier` text fact.
- `education` and `experience` retain the v1 concepts. Study status is not a
  degree; optional experience is not an inferred mandatory minimum.
- `work_constraints` contains `schedule`, `hours`, `minimum_duration`,
  `work_modes`, and `locations`.

Parallel requirement groups represent conjunctive conditions with separately
preserved importance. `Python AND (PyTorch OR TensorFlow)` can be represented by
one Python `all_of` group and one PyTorch/TensorFlow `any_of` group. Do not split
`Python OR SQL` into two mandatory groups. More complex logic that cannot be
represented faithfully must retain the full statement with `operator:
unspecified` for review. A single component overlap never proves the complete
compound requirement. Proficiency and other qualifiers remain unverified.

Concrete usable capabilities and tools belong to `skill`. A willingness to learn
or interest belongs to `interest`; general qualities belong to `trait`.
Mandarin/English belong to `language`, including their proficiency qualifier.
These categories must not be duplicated as skills to increase a recommendation
score. Recognition and scoring must deduplicate canonical skill identities across
groups; extractor schema validation alone does not establish semantic uniqueness.

## Work constraints and scope

`hours` has numeric `minimum`/`maximum` (at least one stated bound), `unit`
(`hours_per_week`/`hours_per_day`), `evidence`, and `condition`. It does not infer
weekly hours from clock times. `minimum_duration` has numeric `value`, the original
`unit` (`days`, `weeks`, `months`, `years`), `evidence`, and `condition`. Three months
remain months, not an invented 90 days. Conditions such as part-time-only must be
retained, rather than applied to all applicants.

Each work mode contains `value` (`onsite`, `remote`, `hybrid`), `allowed` (boolean),
`evidence`, and `condition`. "No remote or hybrid" means two prohibited modes, not
permission for hybrid work. An office address alone does not establish mandatory
onsite work. A location is a source-backed text fact, not assumed Singapore.

These facts describe a job. They do not establish anyone's personal availability,
location feasibility or eligibility. The matching response must display unknown
when the profile lacks explicit corresponding facts. Trait/interest-only overlap
does not meet the concrete-skill recommendation threshold.

## Input boundary

The current `ExtractionInput` includes `description`, title and company. Evidence
is checked against `description` only. Scraper fields such as `location`,
`job_period` or `job_type` are not injected into the description or silently added
to the model output. If a three-month commitment exists only in page metadata, the
model's null duration is an input-boundary limitation, not a description extraction
omission. Acceptance records must retain `description` and `source_metadata`
separately and state which facts were actually available to the model.

## Measurement limits

`quality.score` is quote coverage only. Every nested condition and qualifier is
included in the quote check. The diagnostic can flag a few explicit interest or
language misclassifications, but it is not a semantic classifier or completeness
guarantee. All results require human review, even at coverage 1.0.

Hours and duration additionally have conservative numeric/unit provenance guards.
Four days per week cannot become four hours per week, and clock-time schedules
cannot be converted to weekly hours. Months cannot become days or weeks. A source
quote can be present while `numeric_hours_not_supported` or
`numeric_duration_not_supported` is raised. Raw model output remains intact for
audit; the matching UI must suppress unsupported numeric values and request review.
These guards do not establish the interpretation of min/max or personal feasibility.
Unrecognized wording remains for manual review rather than silently passing.

## Closed source pages

InternSG parser `internsg-2026-10-v3` reads explicit closed status only in the site's
job-header action badge or direct application notice. "Closed" in job prose or
unrelated page content cannot close a record. A parsed closed record is persisted
as `closed`, including status changes with an unchanged content hash. Closed jobs
are excluded from discovery and recommendation candidates by the existing status
filters. Reopening requires an explicit later source observation. This does not
claim that an unmarked page is guaranteed current; an unmarked stale page remains
an external-source limitation.

The offline evaluator separately reports exact fact-value coverage, category
agreement for exact shared values, missing/extra labels and per-case differences.
These are string-based diagnostics, not semantic accuracy; valid paraphrases can
be penalized. Independently review source facts, AND/OR logic, scope, omissions,
and the recommendation explanation. Extraction metrics do not measure explanation
correctness. Mock replay against its own fixture measures wiring only.

## Offline verification

Run `python -m pytest tests/job_extraction -q` from `backend`. The tests include
v1/v2 history coexistence, cache separation, required schema keys, primary and
conditional duties, typed requirements, compound/alternative atoms, original
duration units, part-time scope, prohibited work modes, evidence for nested facts,
and distinct coverage/classification/omission diagnostics. Provider integration
tests use `httpx.MockTransport`; they make no real provider calls.
