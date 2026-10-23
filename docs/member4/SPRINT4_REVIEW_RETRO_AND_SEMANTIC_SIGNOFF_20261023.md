# Sprint 4 closeout sheet — prepared 23 Oct 2026

This is a **meeting worksheet**, not signed minutes or a declaration that Sprint 4 is
complete. The planned Sprint 4 period is 12–25 Oct. The team has confirmed a
400-hour project total (five members × four sprints × 20 hours); the allocation
is a team-reported figure, not a measurement inferred from Git commits.

## Review: demonstrate and record the result

| Item | Evidence available for the meeting | Team decision / reviewer / date |
| --- | --- | --- |
| Core job/profile/favorite and application flows | GitHub PRs, CI and local regression evidence; pin the exact demo commit | **To record at Review** |
| Real InternSG form fill, with no submission | [Installed-extension acceptance](SPRINT4_INSTALLED_EXTENSION_AND_SCHEDULER_20261023.md): synthetic values appeared in five fields; CAPTCHA empty; no employer Submit | **To record at Review** |
| Scheduled source worker | Same record: optional Compose worker starts locally after the configuration fix; no team deployment or due-source fetch was observed | **To record at Review** |
| Source-backed recommendation | [Saved Stripe review bundle](../member3/examples/stripe-source-review-20261021/README.md): a fictional-profile local suggestion exists behind an opt-in correction; human approval is pending | **To record at Review** |
| CI/CD and system demonstration | Show a pinned successful run and run the 40-minute rehearsal; record both backup videos | **To record at Review** |

For each item, record **accepted / accepted with limitation / not accepted**,
the exact demonstration and commit/URL, comments, and owner of any defect. A
green test alone does not make the whole Sprint accepted. Do not use the
fictional form values for a real application.

## Stripe semantic sign-off: compare meaning, not just hashes

Saved posting: Stripe `Software Engineer, Intern`, job ID `8130883`; the source
snapshot and the unchanged original live model result are in the
[review bundle](../member3/examples/stripe-source-review-20261021/README.md).
The eight-operation correction remains
`proposed_local_correction_requires_user_review`; do not relabel it approved.

| Check | Exact saved JD wording to compare | Proposed interpretation | Human verdict / initials |
| --- | --- | --- | --- |
| Production-software statement | “Write software that will be used in production, and has meaningful impact to Stripe’s business and users.” | A **responsibility of the internship**, not proof the applicant already deployed production software. The summary instead quotes the separate “work on projects across our stack...” sentence. | **Pending** |
| Programming experience | “Experience and familiarity with programming, either through side projects or classwork.” | Requirement group and separate `experience.requirement` both retain this qualitative requirement; `minimum_years=null`. Classwork/side projects are allowed; no professional-years minimum is invented. | **Pending** |
| Education / alternative | “At least 1 year of university education, or equivalent work experience.” | Preserve the **or** relationship; do not demand both. The degree-in-progress sentence is separate. | **Pending** |
| Technology names | “We work mostly in Ruby, Java, Javascript, Go, and Scala. We believe new programming languages can be learned...” | Team stack background, **not** a requirement to know one of these languages already. | **Pending** |
| Specialized knowledge | “One or more areas of specialized knowledge ... balanced with general skills and knowledge.” | A composite preferred condition; a bare `Frontend` tag alone must not satisfy it. | **Pending** |
| Personal traits | “Ambitious builder”, “Rigorous thinker”, “Adaptable problem solver” paragraphs | Retain as unspecified traits, not automatically verified technical skills. | **Pending** |

Review the remaining groups against `source.json`, especially qualifiers and
`required` versus `preferred`, before signing. The local recommendation example
shows **one** related software-development activity from a fictional profile;
it is not evidence of overall eligibility or a real applicant match. PR #49
also reports a separate Cantina interpretation issue; it is **not** covered by
the Stripe sign-off.

## Retrospective: fill from the actual discussion

| Prompt | Team's dated observation | Evidence / owner | Action and due date |
| --- | --- | --- | --- |
| What went well? | **To record** | **To record** | **To record** |
| What slowed us down or escaped testing? | **To record** | **To record** | **To record** |
| What will we change in the next delivery? | **To record** | **To record** | **To record** |

Meeting date, attendees and facilitator: **to record**. Sprint 4 DoD verdict:
**pending the actual Review**, including any unresolved limitations and owners.
If the timebox ends before acceptance, say “Sprint period ended; final acceptance
pending” rather than “all done”.
