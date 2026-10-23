# Private PDF resumes and unified application preparation

Implemented locally on top of the scheduled-source/email pilot. No deployment or real employer submission is part of this acceptance.

## What an uploaded PDF now does

1. The original PDF bytes are stored privately for the authenticated account. The user can download the same file and reuse it across application preparation pages. Old filename-only metadata is explicitly distinguished from an uploaded file.
2. A bounded local parser extracts readable text. Labelled contact details and explicit education, experience/project and skills sections are offered as conservative suggestions. The user selects fields to copy into the editable profile, reviews them, then selects **Save Profile**. Uploading alone does not change saved personal data.
3. Existing job discovery, requirement comparisons and form preparation consume those reviewed saved profile fields. Nationality is not inferred. Name is suggested only when explicitly labelled. No AI-generated personal introduction is created.
4. An email draft can choose the stored PDF by `resume_id`. The backend verifies ownership and copies actual bytes into the draft. The email review binds the filename and hash, and the receiving test mailbox can be checked against the original file byte for byte.

The stored original file and reviewed profile fields serve different purposes. Text extraction is not a claim that the resume was semantically understood perfectly or that the applicant qualifies for a job. Columns, headings and unusual PDF layouts can need manual correction. Image-only PDFs remain available as files but are marked `needs_text`; OCR is not implemented. Encrypted, malformed and oversized files are rejected with actionable errors.

## One preparation flow

Each active job has one **Prepare application** entry. `/jobs/:id/prepare` shows the posting, saved profile details and an explicit choice of a private uploaded PDF before the channel-specific next step.

- Email: use the selected file and editable draft, then preview and confirm. Saved user-written introduction and availability prefill a new email draft. The transport remains the loopback test pilot.
- Supported original forms: review profile details and continue to the existing InternSG or Greenhouse/Lever workflow. External PDF file inputs remain manual. The user can download the selected original PDF before uploading it to the employer's form.
- Other official application sites: save a preparation record and continue to the original link. Ashby and currently unsupported Greenhouse EU pages use this route without claiming extension support.
- Closed/expired jobs and unsafe or absent URLs: preparation is unavailable, with instructions to check the source.

Changing the selected PDF clears email review and confirmation while preserving message edits. Returning through the profile page preserves the selected resume ID in the allowed local return URL. The selector and all binary routes still validate ownership; a query parameter cannot grant access to a different account's file.

`/application-history` aggregates existing ordinary application and email records in one stable, globally sorted and paginated result, with a channel filter. It does not replace the old tables or invent submission events. The UI distinguishes preparation drafts, self-reported applied statuses, saved assistant records and test email acceptance. Existing manual status changes and saved assistant answers remain accessible.

## APIs and storage

- `POST /profile/resumes/upload`: multipart `file`, actual PDF, at most 2 MiB.
- `GET /profile/resumes`: summary flags only, including `has_file`, hash, extraction status and page count. Old JSON metadata creation remains compatible.
- `GET /profile/resumes/{id}`: owner-only text, suggestions and notice.
- `GET /profile/resumes/{id}/content`: owner-only original PDF attachment, no-store and nosniff.
- `DELETE /profile/resumes/{id}`: remove the owner's library entry and its original bytes. Confirmed profile fields and email snapshots are retained, as the UI explains before deletion.
- Email draft create/update accepts `resume_id` or legacy direct `attachment`, mutually exclusive. Omitting both on update preserves the current attachment; changing it invalidates review.
- `GET /jobs/{id}/application-context`: private profile and server-chosen channel, using the existing supported-host contract.
- `GET /application-history`: private union of existing records, filtered before global pagination.

Migration `20261023_0007`, following `0006`, adds `resume_file_contents` keyed to the existing metadata row. Binary content, extracted text and suggestions are deferred; list/profile/history queries do not load or return the PDF body. New file routes accept the normal web session, not extension `jpx_` credentials. Success and validation/authentication errors are no-store.

The parser runs with Python isolation, a minimal environment, no network connections, at most two simultaneous workers and a six-second parent timeout. Windows Job Objects or Unix resource limits constrain memory to 256 MiB and CPU time; the parser also bounds page count to 20, text length and decompressed content streams. Unsupported limit setup fails closed. Multipart request size is bounded even without a Content-Length header. These controls do not claim comprehensive PDF malware scanning.

The parser uses [pypdf's text extraction](https://pypdf.readthedocs.io/en/stable/user/extract-text.html); reading image text requires OCR and is intentionally not represented as a successful extraction.

## Local verification

The acceptance uses a real, fully formed fictional resume PDF with labelled contact information, education, work/project history and six explicit skills. There is also an image-only PDF, an encrypted PDF and a disguised invalid file. No customer resume or production credential is included in the evidence.

The independent loopback HTTP harness verifies exact upload/download bytes and SHA, unchanged profile immediately after upload, explicit reviewed-field saving, downstream keyword discovery, the three channel contexts, private access, invalid/encrypted/oversized files, honest image-only status, draft preparation, global history pagination and actual MIME delivery. Deleting a library file does not invalidate its already copied email snapshot. A second send is rejected and the unique subject is received once at `.test`.

A separate ordinary account performs browser upload, review/copy/save, PDF selection and download, returning from profile, three preparation branches, email preview and explicit confirmation, history filtering and reload persistence. The final browser message retains the edited body after changing PDF selection, and its received attachment matches the original file. The browser download is independently hashed too.

New source jobs in this local dataset have not had their requirements extracted. The PDF-derived profile produces labelled unreviewed keyword leads; it is not reported as a validated recommendation, matching percentage or eligibility decision. This does not change the requirement-extraction quality boundary.

The existing owned SQLite acceptance workspace was backed up, verified against the previous table/column sets, stamped at `0006`, then upgraded to `0007`. Existing account/job/crawl/application counts were checked before and after. A deployed database and production SMTP have not been changed.

Final executable evidence, full tests, coverage, screenshots and the patch are delivered in `outputs/JobPilot_PDF与统一申请验收_20261023` outside the checkout. There is no new model charge, public submission, PR push or merge in this change.
