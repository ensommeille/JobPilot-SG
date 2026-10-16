# JobPilot extraction: source versus model output (15 October 2026)

**Purpose:** project evaluation of one extraction, not a personal job-search
recommendation. **Status:** Codex first-pass semantic audit completed; not
independently approved by a teammate or a human reviewer. No application sent.

- [Original InternSG listing](https://www.internsg.com/job/ilodia-labs-pte-ltd-retail-e-commerce-operations-intern/)
- Saved job ID: `9408ec7d-9f49-41de-be6e-8d62777d912d`
- Live extraction run ID: `4ec90a75-2d9a-46d3-b0e4-0667aade66dd`
- Baseline: the 3,029-character JD saved in `job_postings.description`, which
  matches the job-description section of the listing checked on this date.
  Listing metadata outside that description is not scored here.
- Model: DeepSeek `deepseek-flash`, one paid request, no fallback; status
  `needs_review`. Its `quality.score=1.0` means only that all 24 evidence
  snippets occur in the saved JD, **not** that semantics are perfect.

The two comparison columns below are **Chinese paraphrases** for easy reading,
not extra model output or verbatim translations. The original English is at
the listing link; the exact model payload is in the identified database run.
`Correct` means the model retained the fact and its main meaning. `Partial`
means factual content is present but structure, qualification or priority was
lost. `Missing` means a fact present in the model input was not represented in
its structured output.

## Role summary and applicant conditions

| Item | Source standard (from JD) | What the model extracted | First-pass judgment |
| --- | --- | --- | --- |
| Role identity | Ilodia Labs' retail/e-commerce operations internship supporting Tasty Toastys; work with founder Chanel. | Same company, role, brand and founder in the summary. | **Correct:** no role-identity mismatch found. |
| Role summary | Retail-stockist support and order fulfilment are **core**; sales materials and brand/project coordination are **if time permits**. | Lists retail, fulfilment, e-commerce, displays, sourcing and project coordination together, without core/conditional priority. | **Partial:** no invented work, but priority was lost. |
| R1 | Organised, reliable and detail-oriented. | Same, under `required_skills`. | **Partial classification:** fact correct; this is a general trait rather than a specific skill. |
| R2 | Comfortable with packing, stock handling and display maintenance. | Same, under `required_skills`. | **Correct:** practical ability and source meaning retained. |
| R3 | Basic Canva, clear-layout sense and spreadsheet familiarity. | Same three-part sentence under one `required_skills` item. | **Partial structure:** fact correct, but one compound item must not imply all three abilities are verified from a Canva-only profile. |
| R4 | Willing to learn, ask questions and report progress. | Same, under `required_skills`. | **Partial classification:** behavioural expectation, not evidence of an already-mastered tool. |
| R5 | Interest in retail, products and creative brands. | Same, under `required_skills`. | **Partial classification:** interest, not a concrete skill. |
| R6 | Basic spoken Mandarin for supplier liaison; written translation tools are allowed. | Same under `required_skills`, and basic spoken Mandarin again under `languages`. | **Partial structure:** meaning retained, but one source condition appears twice. Matching/ranking must not double-count it. |
| Education / years of experience | No explicit degree, enrollment or minimum-years condition in this JD. | Empty / null. | **Correct:** no unsupported qualification invented. |
| Preferred conditions | No separate “preferred” section or label in this JD. | Empty preferred lists. | **Correct:** no preference invented. |

## Responsibilities: all 16 source bullets compared

The model returned 16 responsibility items for the 16 bullets in the JD. The
source standard and model output are paraphrased independently below so the
comparison is visible, rather than presenting a checkbox list of model text.

| # | Source standard (from JD) | What the model extracted | Judgment |
| --- | --- | --- | --- |
| D1 | Pack stockist orders/replenishments; check count and condition. | The same packing and checks. | Correct |
| D2 | Count stock, maintain inventory records, flag shortages or discrepancies. | The same inventory work. | Correct |
| D3 | Maintain stockist displays, arrangement, price labels and signage. | The same display work; omits the inconsequential word “our”. | Correct |
| D4 | Organise stock and packing materials. | The same organisation task. | Correct |
| D5 | Pick, check and pack online orders for dispatch. | The same online-order flow. | Correct |
| D6 | Update product listings and related admin records. | The same update task. | Correct |
| D7 | Prepare stock, packaging and displays for events/pop-ups. | The same event preparation. | Correct |
| D8 | Check and reconcile returned event stock. | The same return-stock work. | Correct |
| D9 | Create simple retail signage/cards/layouts with Canva. | The same Canva design task. | Correct; conditional priority omitted from summary. |
| D10 | Edit/crop/resize product photos. | The same photo editing. | Correct; conditional priority omitted from summary. |
| D11 | Adapt brand assets to formats while preserving consistency. | The same asset adaptation. | Correct; conditional priority omitted from summary. |
| D12 | Research suppliers, materials and production options. | The same sourcing research. | Correct; conditional priority omitted from summary. |
| D13 | Compare quotes, minimum quantities, lead times and samples. | The same supplier comparison. | Correct; conditional priority omitted from summary. |
| D14 | Follow up supplier enquiries and track next steps. | The same follow-up work. | Correct; conditional priority omitted from summary. |
| D15 | Maintain task lists/timelines; flag delays or missing information. | The same coordination task. | Correct; conditional priority omitted from summary. |
| D16 | Coordinate samples/production under founder guidance. | The same coordination task. | Correct; conditional priority omitted from summary. |

The conditional-priority note comes from the JD's role introduction. It is
not a claim that every D9–D16 bullet is individually labelled “optional”.

## Present in the input, absent from the structured output

| Source standard (from the saved JD) | Model output | Judgment / product implication |
| --- | --- | --- |
| Full-time: weekdays, 09:30–18:30, with a one-hour lunch. | No work-schedule field. | **Missing from extraction schema/output.** Do not infer schedule compatibility. |
| Part-time/flexi: negotiated case by case during work hours, minimum 20 hours/week and three months. | No minimum-hours or duration field. | **Missing from extraction schema/output.** Do not infer hours/duration compatibility. |
| Remote and hybrid unavailable. | No work-mode field. | **Missing from extraction schema/output.** Do not infer remote eligibility. |

The saved input also describes mentoring and learning outcomes. Those are not
applicant requirements or job duties, so their omission from the present
requirements/responsibilities schema is **not** scored as an error. The source
page's salary, location metadata and application instructions were outside the
3,029-character description sent to this extraction run; do not attribute
their absence to the model without a separate whole-page pipeline test.

## First-pass conclusion and narrow reviewer questions

- **Factual coverage of extracted items:** 16/16 duty bullets and 6/6
  “looking for” bullets are represented; no invented requirement was found in
  this one sample. This is not a benchmark accuracy score.
- **Structural issues:** role priority is flattened; traits/interests/language
  are mixed into `required_skills`; Mandarin is duplicated across fields;
  working arrangements are not represented.
- **What a project reviewer can confirm:** (1) whether the source's conditional
  wording should be preserved explicitly; (2) whether R1/R4/R5/R6 should be
  separate from concrete skills; (3) whether hours, duration and work mode
  belong in the recommendation contract. No one needs to re-check all 24
  evidence snippets unless one of these judgments is disputed.

This is one retail-role test fixture, not an AI/software-role acceptance set.
The matching code changes remain local; the running Docker backend was not
rebuilt for this audit. No employer application, CAPTCHA or final Submit was used.
