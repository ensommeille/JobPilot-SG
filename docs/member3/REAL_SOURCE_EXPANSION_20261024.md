# Real Singapore source expansion, 24 October 2026

The local self-test database had a deliberately narrow source setup: four
employer ATS boards and one SP Group programme overview. InternSG support had
not been removed, but that separate local workspace had never registered it.
Its 13 active records were 12 real ATS vacancies and one official programme;
the two negative email fixtures were closed and excluded.

## Collection changes

- InternSG accepts either its HTTPS origin or `/jobs/` as source configuration;
  robots and listing paths are resolved from the origin. The reviewed catalogue
  now stores the origin, avoiding `/jobs/jobs/`.
- Collection follows the site's explicit next-page link, using the observed
  canonical `/jobs/2/` form. It stops at 100 distinct links/details or 10 listing
  pages, whichever bound is reached first. Cross-page links are deduplicated;
  the site's `?f_pg=N` detail-navigation marker is removed from canonical URLs.
- Every InternSG request is separated by at least 1.5 seconds. Robots denial
  remains fail-closed. HTTP 403/429 stops further requests in the batch. Other
  later-page failures retain successfully parsed records; existing stored jobs
  are never cleared by a failed or empty HTML batch.
- The database-backed InternSG adapter retains explicitly Singapore early-career
  vacancies and excludes senior-title roles. An explicit closed notice can still
  update an existing posting. Location/eligibility is not invented from JD prose.
- The InternSG catalogue policy is daily, at most 100 links and 100 details per
  run. Running the scheduler is an explicit operator action; importing FastAPI
  never starts a collection loop.
- Lever JSON lists and additional source text are now retained in order. They
  contain the actual responsibilities and skill requirements, which were absent
  when only `descriptionPlain` was saved. No model is involved in ingestion.
- Optional `description_blocks` preserve paragraph, heading and list display.
  Existing canonical JD text and hashes are unchanged when only these display
  blocks are backfilled. A changed canonical JD clears stale blocks if its new
  source record has no replacement blocks.

## Reviewed additional public boards

Each endpoint was read successfully on 24 October 2026 before registration. The
current Singapore early-career scope found Stripe 4, CSIT 35, ShopBack 9, Dexmate
1, Venti Technologies 18, Palantir 2 and SimplifyNext 7 postings. This is an
observation of public listings, not a promise of future availability or applicant
eligibility. CSIT's qualifications and any citizenship restrictions must still
be assessed for the individual applicant.

- Stripe: `https://boards-api.greenhouse.io/v1/boards/stripe`
- CSIT: `https://api.lever.co/v0/postings/csit`
- ShopBack: `https://api.lever.co/v0/postings/shopback-2`
- Dexmate: `https://api.ashbyhq.com/posting-api/job-board/dexmate`
- Venti: `https://api.ashbyhq.com/posting-api/job-board/goventi`
- Palantir: `https://api.lever.co/v0/postings/palantir`
- SimplifyNext: `https://boards-api.greenhouse.io/v1/boards/simplifynext`

The ATS catalogue defaults to six-hour intervals. CSIT permits a bounded complete
batch of up to 100 because its 35 qualifying posts exceed the former 20-post
default. Other additional boards fit within their 20-post bounds. A complete,
successful nonempty JSON board can close vanished postings; partial and empty
boards cannot mass-close the stored set.

## Local operation and evidence

The acceptance worker is bound to the owned `jobpilot-feature-acceptance`
SQLite workspace, after migration `20261024_0009`. Before each invocation it
creates a SQLite backup and fingerprints user, profile, PDF, application, email,
AI, favorite and related private tables. It verifies those rows after every
source publication and preserves all pre-existing job IDs. Backups and private
worker inputs must not be committed or included in public evidence packages.

A three-post InternSG scheduled smoke run succeeded before expansion. The first
larger batch correctly surfaced the site's canonical trailing-slash redirect as
a partial run rather than claiming full pagination; the canonical URL was then
corrected. The subsequent bounded refresh and original-source display-block
backfill are recorded in local acceptance evidence.

Final local acceptance contained **180 advertised vacancies**: 92 InternSG and
88 employer ATS records, across 77 employer names. One SP Group official programme
overview is displayed separately, so the public active total is 181. The two
closed negative fixtures remain excluded. All 180 concrete JDs have display
blocks; all pre-existing job IDs and canonical JD hashes were preserved.

The successful InternSG run attempted 100 distinct details, retained 92 within
scope (74 new and 18 already stored), and had zero failures. This is a bounded
HTML scan, not a claim to have inventoried all 44 site listing pages. A second
complete Stripe public GET returned 0 new, 0 updated and 4 unchanged. There are
no duplicate `(source_id, external_id)` pairs. A later due-source check returned
an empty list, confirming that successful sources are not immediately recollected.
The source worker made zero model calls, sent no mail and submitted no applications.

For an operator-managed environment, configure the intended database and an
existing active administrator, then register only explicitly reviewed catalogue
keys. For example, from `backend`:

```powershell
python -m app.ingestion.scheduler --once --actor-id ADMIN_UUID --catalog internsg --catalog greenhouse-stripe --catalog lever-csit --catalog lever-shopback --catalog ashby-dexmate --catalog ashby-venti --catalog lever-palantir --catalog greenhouse-simplifynext
```

`--once` collects due sources once and exits. A separate explicitly started
`--loop` process is required for future automatic refreshes. Neither mode invokes
an LLM, sends application mail, visits employer application forms or submits an
application. Keep the operator's actual database URL and administrator identity
outside committed commands and reports.

## Verification

The ingestion suite passed **121 offline tests**, with external sockets blocked
and zero external attempts. Tests cover catalogue normalization, real next-page
shape, cross-page deduplication and bounds, robots denial, access/rate-limit
stopping, retaining successful records after later failures, closed-job exclusion,
Singapore early-career scope, complete JSON close semantics, lease ownership,
full Lever requirements and display-block preservation/invalidation. Ruff checks
and formatting checks passed for the ingestion package and tests.
