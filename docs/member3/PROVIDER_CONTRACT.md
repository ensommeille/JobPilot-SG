# Shared LLM Provider Contract v0.1.0

Status: implemented contract and Mock; Qwen/DeepSeek adapters are not included or verified.

## Interface and ownership

Import DTOs and errors from `app.llm`. Implement the runtime-checkable `LLMProvider` protocol:

```python
class LLMProvider(Protocol):
    @property
    def name(self) -> str: ...

    @property
    def is_mock(self) -> bool: ...

    async def generate_structured(self, request: StructuredGenerationRequest) -> StructuredGenerationResponse: ...
```

Use a stable nonempty provider name, for example `qwen` or `deepseek`. Set `is_mock=False` only for actual model calls. Provider construction, credentials, client reuse, cleanup and transport retries belong to Member 4 / the application composition root. Do not block the async event loop with synchronous HTTP calls. Propagate cancellation and cancel underlying transport operations when possible.

The shared package must not import extraction models or any form-filling business model. The two consumers can use unrelated JSON Schemas. Do not create another class named `StructuredGenerationResponse` in a different module: the consumer expects the shared DTO instance, not a plain dictionary or lookalike class.

## Request

- `request_id`: nonempty correlation ID; preserve it in internal tracing. Extraction uses `result_id:attempt`. It is not a vendor idempotency guarantee.
- `messages`: ordered `Message` objects with `system` or `user` role and nonempty content. Never flatten untrusted source content into a new system instruction.
- `schema_name`: alphanumeric/underscore name for the requested object.
- `output_schema`: JSON Schema as a Python dict. The provider must use it in supported structured output controls, or explicitly serialize it into a JSON-constrained prompting strategy. Do not ignore it.
- `temperature`: float in [0, 2], default 0.0; reject unsupported settings instead of silently changing behavior.
- `max_output_tokens`: integer in [1, 16000], default 2500; logical output limit, not guaranteed support by every model.
- `contract_version`: exactly `0.1.0`.

The extraction schema uses object/array/string/number/null, `$defs`, local `$ref`, `anyOf` for nullable values, required keys, `additionalProperties: false`, and bounds on lengths/items/numbers. All extraction object keys are required; unknown facts are null or empty arrays. Member 4 must verify the selected model/API accepts this shape. If native structured mode rejects constraints, a documented JSON-mode/prompt-based route is allowed, with full local validation retained by the consumer. If no viable route exists, raise `ProviderCapabilityError`.

Both `output_schema` and successful `data` must be finite, JSON-serializable objects. Python-only values such as `datetime`, `bytes`, NaN, and Infinity are rejected. Provider identifiers use only letters, digits, `_`, `.`, and `-`. The consumer revalidates a snapshot of every returned DTO, so mutating nested data after initial DTO construction does not bypass the boundary.

Do not assume a particular model currently supports native JSON Schema. Do not remove meaningful constraints from the contract without coordinating with consumers. The source limit of 40,000 characters is not a model-context guarantee: validate token/context limits or return a capability error. Do not silently truncate a JD.

## Response

Return `StructuredGenerationResponse`, including:

- `data`: parsed JSON object (`dict`), not JSON text, a list, Markdown fences, or a provider SDK response. Business schema validation happens later. An empty object is valid at the transport contract level and will fail the job schema.
- `provider` and `model`: actual provider and configured/resolved model identifiers.
- `finish_reason`: `stop`, `length`, `refusal`, or `unknown`. Map vendor-specific results deliberately. Never label truncated JSON as `stop` simply because a prefix happens to parse.
- `usage`: `TokenUsage(input_tokens=..., output_tokens=...)`. Unknown values are `None`, not fabricated zeros. Providers with internal retries should document whether usage covers only the final response; this DTO is not a complete billing ledger.
- `provider_request_id`: vendor correlation ID if supplied; otherwise `None`.
- `latency_ms`: optional nonnegative, finite provider-level duration. Extraction also measures end-to-end logical-call duration.

`finish_reason="stop"` requires a non-null dict. For length/refusal/unknown, data may be null; the extraction consumer never accepts it as successful output. Determine finish reason before trying to parse truncated/refused content.

Parse a single JSON object strictly. Invalid JSON, non-object JSON, non-standard NaN/Infinity or ambiguous payloads should raise `InvalidStructuredOutputError`. Do not execute returned text or use `eval`. If SDK parsing fails, map it to the shared error rather than returning a fabricated empty extraction.

## Errors and retry ownership

- `ProviderAuthenticationError`: missing/invalid credentials or authorization failure; no consumer retry.
- `ProviderRateLimitError`: rate limit after the provider's bounded transport policy; no consumer retry.
- `ProviderTimeoutError`: provider deadline exceeded; no consumer retry.
- `ProviderCapabilityError`: unsupported mode/schema/limits; no consumer retry.
- `InvalidStructuredOutputError`: malformed/non-object JSON; extraction may retry once with repair instructions.
- `LLMProviderError`: other known provider failures, with a stable safe `code`.

Exception messages may contain vendor payloads or secrets. Consumers persist only static safe codes. Never put request text, URLs containing tokens, or secrets into error `code`. Unknown exceptions are recorded as `unexpected_provider_error` without their message.

The provider handles only bounded transport retries (temporary network/server errors or rate limits). Do not perform hidden semantic/schema-repair retries. The extraction consumer handles business validation and malformed JSON, with one repair retry by default (configurable 0–2). With N transport attempts, two consumer attempts can cause up to 2N actual API calls; document and cap N.

Concrete providers shared by concurrent requests must document and test their own concurrency safety. `MockProvider` is a deterministic development fixture, not a production queue, fallback model, or accuracy simulator.

The consumer has a 60-second timeout for each logical provider call by default, including its internal retries. Cancellation does not guarantee a remote server stopped processing or billing. No paid calls occur in this package's offline tests/demo.

## Logging and safety

Do not log API keys, full request bodies, resumes or full vendor errors by default. Extraction audit records only identity, versions, safe outcomes and usage metadata, not full prompt/response history. The extraction itself contains public JD quotes; future private sources require an appropriate data policy.

Source text is untrusted and kept in a JSON user-message envelope. This is defense in depth, not proof of prompt-injection immunity. No tool execution is provided by this contract. The extraction schema and evidence checks do not prove semantic correctness, so every result requires review.

## Acceptance checklist for Member 4

- Pass a non-job schema and the actual nested job schema.
- Preserve generic request fields, actual model identity and unknown usage as null.
- Test valid JSON, invalid JSON, arrays, refusal, token truncation, unknown finish reasons.
- Test auth, rate-limit exhaustion, timeout, capability rejection and cancellation.
- Test transport retry caps separately; ensure no job-specific retries inside Provider.
- Ensure secrets never appear in consumer audit output.
- Run one explicitly authorized real smoke call and then human-reviewed extraction evaluation. Mock tests alone do not validate vendor compatibility.

Versioning: changing argument names, required fields, return types or error meaning requires coordinated contract versioning. This is an initial team proposal, not a guarantee that independently written adapters already conform.

