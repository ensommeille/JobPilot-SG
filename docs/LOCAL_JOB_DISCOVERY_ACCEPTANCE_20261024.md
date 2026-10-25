# Local job discovery and application advice — 24 October 2026

**Later local update:** see [v9 evidence, clearer decisions and application reuse](RECOMMENDATION_APPLICATION_ACCEPTANCE_20261024.md).
The model verification below preserves the preceding v8 checkpoint.

This update builds on GitHub `main` commit
`dd085f81e604b23ca3b464d2510afbedfddd0fc2`, preserving the earlier local unified
Jobs work. Source data and application code are separate: the former 13-record
local workspace was not evidence that GitHub lacked InternSG support.

## Real catalog and refresh

The owned local database now has **180 concrete advertised vacancies** from
77 employer names: **92 InternSG and 88 official employer ATS records**. One SP
Group programme overview is separately classified, making 181 visible records.
Two closed synthetic negative fixtures remain excluded. A title-keyword screen
finds 61 technical-direction titles; this is not a personal-match count.

All 180 concrete JDs have text-only display blocks. Existing job IDs, canonical
descriptions and hashes were retained. Source-worker backups and row fingerprints
verified that user, profile, PDF, application, email and existing AI records were
not altered during collection. See the
[source expansion record](member3/REAL_SOURCE_EXPANSION_20261024.md).

There are 12 scheduled sources and one manually maintained programme source.
ATS intervals are six hours; InternSG is daily with a 100-detail bound. A separate
local worker is running with live-model keys cleared. It initially returned no
due work, so starting it did not immediately recollect the sources. This is a
local process, not an installed OS service or hosted deployment.

## Reading JDs

Migration `20261024_0009` adds nullable `job_postings.description_blocks` metadata.
The migration was applied only to the owned local SQLite workspace after backup;
all existing columns across 21 tables were fingerprinted unchanged.

Display structure is separate from canonical evidence. Original headings,
paragraphs and lists are rendered as safe JSX text. Markup is used only when its
visible text corresponds to the canonical JD; otherwise the original text's
line/list boundaries are used. No HTML or script is injected, and the model does
not rewrite a JD for display. Lever's source lists are now included in newly
collected JDs, retaining qualifications that were previously omitted.

## One recommendation and detail flow

Jobs retains one **Recommend to me** action. It uses the reviewed saved profile,
shortlists up to five current jobs and replaces the browse results with advice.
**Show all jobs** restores the prior filters, sorting and page without a provider
call. The Profile navigation link says **View jobs**.

The list and job detail share one presentation: a decision headline, a small
status label, up to three key conditions, short evidence summaries and expandable
source quotations. States are `priority_apply`, `consider`, `check_first` and
`not_priority`. Unknown facts and future duties are not explicit skill gaps;
education-only support or repeated Python citations cannot manufacture a priority.
This is action guidance from available evidence, not a hiring probability.

`GET /jobs/{job_id}/ai-assessment` reads a matching saved item across batches for
the current user, profile, JD and analysis version. It never reserves a run,
fetches a paid runtime or writes the database. Opening a previously analyzed job
therefore reuses the batch. A job without a current analysis offers an explicit
**Analyze this job** action; page loading and polling never start a model call.

Saved availability is included in minimized professional input. Contact fields
and PDF files are excluded. Broad availability does not establish full-time
attendance or a specific duration, and academic dates are not availability.

Every public batch report also verifies current inputs. If profile, JD, source,
deadline or pipeline changes, `is_current=false`; the UI labels the record as
historical, hides current action advice, and retains only expandable snapshot
evidence. Historical runs are not silently rewritten or automatically retried.

## Local verification records

The live provider audit and final verification summary are recorded separately
from source-collection evidence. Raw model inputs, responses, databases, credentials
and personal PDFs remain outside the repository. Rejected live attempts are
retained without rewriting their raw responses or stored status:

- v5: non-verbatim quotations, including altered PDF spacing and hyphens.
- v6: missing required item fields and invalid category/condition shapes.
- v7: the format passed, but a skipped JD segment and a quotation containing a
  redacted project header were correctly rejected.

The v8 internal citation protocol uses input-bound original-source ranges,
`{start_id, end_id}`. Both issued endpoints must belong to the current input and
the same job/profile field and entry, in original order. The server slices one
complete continuous interval from the original text, including every intervening
character, with a 4,000-character bound. Profile segments containing `[redacted]`
are not issued; a range crossing such a segment is still rejected. Old ID arrays
are not accepted by the new strict schema or converted into ranges.

This changes how the model identifies a source; it does not normalize, fuzzily
repair or invent source text, and it does not turn a rejected earlier response
into a successful run. A valid citation proves where the text came from, not that
the model's interpretation or AND/OR condition coverage is correct. Responsibilities
remain available in expanded records but cannot supply the first-screen strengths
or core evidence used to raise application priority.

The full v6 backend regression passed **1,458 tests** with external networking
blocked (zero external socket/DNS attempts). The v7 prompt-only update passed
244 related tests; 34 source/prompt checks passed again after the final wording
change. Frontend lint, TypeScript and production build passed. Browser acceptance
uses the existing ordinary account and its reviewed saved profile. The browser
test specifications were updated and syntax-checked; the automated Playwright
suite was not executed locally.

The v8 live batch `f3c09c86-b212-4919-b156-b6b8c88145bd` completed successfully
with `execution_mode=live`, `is_current=true` and `requires_review=true`. Its
45 JD quotations and 32 profile quotations independently match their own original
job or saved field. Read-only assessment lookup for all five jobs returns the
same batch, assessment and action advice. The five jobs are from SimplifyNext,
Pensees (InternSG), ShopBack and Cantina. This is a technically successful live
analysis, not five verified personal matches.

Content acceptance remains partial. The original expanded model record still
overstates some model-building/training and fine-tuning duties from related
research evidence. Some enrollment rows selected only part of an otherwise
available education entry, creating false unknowns. These are analysis issues,
not a request for the user to re-enter their profile. The original model rows
remain reviewable and are not silently rewritten as a fully accepted result.

The final free correction is `action-advice-v2`. It derives conservative guidance
from a deep copy without editing the original assessment: a tool name in the
skills list cannot establish a requested building/development/deployment activity;
and optional wording in a neighbouring JD condition cannot make the current core
condition optional. Such activity claims become unknown in the action guidance
and cannot raise its strengths, core-evidence count or order. Both the list and
detail show that the original AI assessments still need review. This correction
made no further provider call.

The full v8 checkpoint passed **1,476 tests** (318.53 seconds, zero external
socket/DNS attempts). After the final advice-only correction, **206 related
tests** passed (43.03 seconds, zero external attempts). The full suite was not
repeated after this last derived-advice change. The final frontend lint,
TypeScript and build passed; its bundle is `index-DHwVoHZY.js`, configured for the
local API at `127.0.0.1:18523`.

Final ordinary-account browser checks passed at 1280- and 390-pixel widths,
without horizontal overflow. `Show all jobs` exactly restored Singapore, Newest,
page 2 and its ten titles. Two repeated recommendation actions reused the same
v8 run; opening its Full Stack detail and returning to Jobs retained that batch.
The detail had no repeated Analyze/Check-my-match action. The final API restart
and all these checks made **zero** new provider calls, and hashes of all eight
stored AI records remained identical. The independent scheduler loop is still
running locally; no additional source was due during its initial checks.

Machine-readable, privacy-minimized evidence:
[verification-job-discovery-20261024.json](handoff/verification-job-discovery-20261024.json).
Screenshots and a copy of the safe evidence are in this task's
`outputs/JobPilot_真实岗位与投递建议_20261024/` folder, outside the repository.

For local user testing, open
<http://127.0.0.1:15523/jobs?ai_run=f3c09c86-b212-4919-b156-b6b8c88145bd>.
The existing ordinary account remains signed in with its reviewed profile. Use
**Show all jobs** to browse the 181 visible records (180 vacancies plus one official
programme overview), **Recommend to me** to reuse this unchanged analysis, and a
job title to view the same guidance and the formatted source JD. A changed profile
or new analysis input can require a new explicitly requested model call.

No hosted deployment, PR merge, real-employer email or application submission is
part of this local acceptance.
