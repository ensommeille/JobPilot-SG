# Member 4 - LLM Provider Adapters v1

Status: implementation submitted for team review. No paid/live smoke call is claimed by this
change; automated tests use HTTP transport mocks only.

## Scope delivered

- Concrete QwenProvider and DeepSeekProvider implementations of the shared LLMProvider contract.
- One OpenAI-compatible asynchronous HTTP transport shared by both adapters.
- JSON-object structured output with the requested JSON Schema serialized into a system
  instruction. Business modules still perform their own schema/semantic validation.
- Safe mapping for authentication, rate-limit, timeout, capability, invalid JSON and transient
  server/network failures.
- Bounded transport retries with exponential backoff.
- Provider/model/request-id/token-usage/latency mapping into StructuredGenerationResponse.
- Environment-backed provider factory using LLM_* variables.
- Offline transport tests; no API key or paid network call is required in CI.

## Team boundary

M3 remains owner of job-specific prompts, job extraction schema, validation, confidence and
quality diagnostics. M4 owns concrete provider transport and vendor adaptation. The same provider
contract will next be reused by M4's profile-to-form mapping and draft-answer service.

M2 remains owner of HTTP routes and persistence. The next M4 milestone is to implement the
FormMappingGateway behind POST /assistant/map-fields. M1's ApplicationFormPage currently uses
MOCK_FORM and can be connected after that gateway implementation is available.

## Configuration

Use backend/.env (never commit real secrets).

DeepSeek:
- LLM_PROVIDER=deepseek
- LLM_API_KEY=<secret>
- LLM_BASE_URL=https://api.deepseek.com
- LLM_MODEL=deepseek-v4-flash

Qwen on Alibaba Cloud Model Studio Singapore:
- LLM_PROVIDER=qwen
- LLM_API_KEY=<secret>
- LLM_BASE_URL=https://<workspace-id>.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
- LLM_MODEL=qwen3.8-flash

## Next milestone

1. Run one explicitly authorized real-provider smoke test after a team API key is configured.
2. Validate the M3 nested job schema against the selected live provider.
3. Implement Profile -> Form mapping and semantic draft generation.
4. Register the concrete FormMappingGateway and replace frontend MOCK_FORM with API data.
