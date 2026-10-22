"""Safe operator guidance derived only from bounded error codes, never provider bodies."""

_MESSAGES = {
    "provider_insufficient_balance": "The model account has insufficient balance or credits. Check the provider account before retrying.",
    "provider_invalid_request": "The model provider rejected the request parameters. Check the model and request configuration before retrying.",
    "provider_authentication_error": "Model authentication failed. Check the server-side API key and its permissions.",
    "provider_rate_limit": "The model provider rate limit was reached. Wait before retrying this batch.",
    "provider_timeout": "The model request timed out. Check the run before retrying; a timeout does not prove that no usage occurred.",
    "provider_capability_error": "The model endpoint or requested capability is unavailable. Check the model and endpoint configuration.",
    "provider_error": "The model service or network is unavailable. Check service availability before retrying.",
    "schema_validation_failed": "The model output did not match the required schema. Review the extraction configuration and keep strict validation enabled.",
    "invalid_structured_output": "The model returned invalid structured output. Review the run before retrying.",
}

BATCH_ABORT_ERROR_CODES = frozenset(
    {
        "provider_authentication_error",
        "provider_insufficient_balance",
        "provider_invalid_request",
        "provider_capability_error",
        "provider_rate_limit",
    }
)


def provider_error_message(code: str | None) -> str | None:
    return _MESSAGES.get(code)
