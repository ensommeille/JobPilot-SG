# M4 AI Form Mapping Assistant v1

Status: implemented on the M4 feature branch; real-provider smoke and browser E2E are pending.

## Architecture and ownership

`POST /assistant/map-fields` (M2 route) obtains the authenticated user's profile snapshot, validates
the submitted form field IDs against the stored form, and calls the existing synchronous
`FormMappingGateway`. M4's `LiveFormMappingGateway` runs `ProfileFormMappingService`, which returns
M2's unchanged `MappingDraft` contract. M2 still owns form lookup, confirmation validation,
application and mapping-record persistence. M1 still owns the form and confirmation UI. M3's job
ingestion and extraction are unchanged. M4 reuses the existing `LLMProvider` contract and factory;
there is no second vendor transport.

## Mapping policy

- Direct rules match normalized, explicit field label/name/context cues for name, email, phone,
  links, education, school/degree when structured, and skills. Context is accepted only when the
  entire normalized context matches a known field name; incidental mentions are ignored. A select
  value is suggested only if it exactly matches an offered option. Missing facts are never guessed.
- Only free-text motivation and relevant-experience questions with profile evidence are sent to an
  LLM. Each request includes that field's metadata and only the required education, experience,
  and/or skills; it does not include the applicant's name, contact details or links. Form metadata is
  explicitly treated as untrusted task data in the prompt.
- The model must return `field_id`, `value`, `confidence`, and `needs_review`. A strict Pydantic
  business check rejects unknown IDs, wrong types, extra fields, empty answers, non-finite/invalid
  confidence, and non-`stop` responses. It cannot persist an answer itself.
- Direct mappings use confidence `0.95` and `needs_review=false`. All semantic suggestions use
  `needs_review=true` and confidence capped at `0.79`, even if the model claims higher certainty.
  These numbers are workflow signals, not calibrated probabilities or accuracy measurements.

`unmapped_fields` identifies fields for manual entry. `missing_profile_fields` identifies absent
profile evidence (and is deduplicated); unsupported fields are unmapped without claiming missing
data. A missing LLM key or a provider authentication, rate-limit, timeout, capability, malformed
output, or generic provider error leaves only affected semantic fields unmapped. Backend startup
does not require a key. M2's existing confirmation endpoint remains the only persistence path.

## Security and limits

API keys come from the existing `LLM_*` environment settings and are not logged. This service does
not log prompts or profile values, and it does not use `eval`. The route's profile snapshot contains
more data than an individual LLM call; the domain service minimizes each request before invocation.
The current field classifier intentionally handles a small English vocabulary, not arbitrary
questions, multilingual forms, complex options, attachments or hidden browser fields. For a free
text school/degree profile, it declines to split the text by guesswork. A provider may still produce
an inaccurate or unsafe draft despite schema validation; user review remains mandatory.

The M1 page consumes the real response for forms returned by `/assistant/bootstrap`, forwarding
field name, options, placeholder and context rather than stripping them from the form snapshot. The
small M1 integration guard added here prevents a mock fallback or failed persistence request from
being shown as a successful submission, and requires non-empty required values. This does not
expand M1's page design or M2's API contract.

## Next integration step

Run an authorized, low-volume Qwen/DeepSeek schema smoke with a valid key; then perform a browser
E2E on a seeded job and profile, checking review, edits, persistence, and history. Neither is
claimed complete by offline tests. See `TEST_REPORT.md` and `INTEGRATION_STATUS.md`.
