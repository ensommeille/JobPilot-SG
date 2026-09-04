"""Shared provider contract v0.1.0; no job-specific models or API clients belong here."""

from __future__ import annotations

import json
from typing import Any, Literal, Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

CONTRACT_VERSION = "0.1.0"


class ContractModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid", strict=True, str_strip_whitespace=True, allow_inf_nan=False
    )


class Message(ContractModel):
    role: Literal["system", "user"]
    content: str = Field(min_length=1)


class StructuredGenerationRequest(ContractModel):
    """Providers must implement this portable JSON Schema subset or raise a capability error."""

    request_id: str = Field(min_length=1, max_length=200)
    messages: list[Message] = Field(min_length=1)
    schema_name: str = Field(min_length=1, pattern=r"^[a-zA-Z0-9_]+$")
    output_schema: dict[str, Any]
    temperature: float = Field(default=0.0, ge=0, le=2)
    max_output_tokens: int = Field(default=2500, ge=1, le=16000)
    contract_version: Literal["0.1.0"] = CONTRACT_VERSION

    @field_validator("output_schema")
    @classmethod
    def require_json_schema_object(cls, value: dict[str, Any]) -> dict[str, Any]:
        _require_json_compatible(value, "output_schema")
        if value.get("type") != "object":
            raise ValueError("output_schema must describe an object at the root")
        return value


class TokenUsage(ContractModel):
    input_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)


class StructuredGenerationResponse(ContractModel):
    """data is parsed JSON, not necessarily schema-valid; the consumer validates semantics."""

    data: dict[str, Any] | None
    provider: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_.-]+$")
    model: str = Field(min_length=1, max_length=300)
    finish_reason: Literal["stop", "length", "refusal", "unknown"]
    usage: TokenUsage = Field(default_factory=TokenUsage)
    provider_request_id: str | None = Field(default=None, max_length=500)
    latency_ms: float | None = Field(default=None, ge=0)

    @field_validator("data")
    @classmethod
    def require_json_object(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is not None:
            _require_json_compatible(value, "data")
        return value

    @model_validator(mode="after")
    def require_success_payload(self) -> StructuredGenerationResponse:
        if self.finish_reason == "stop" and self.data is None:
            raise ValueError("A stopped response requires a JSON object")
        return self


def _require_json_compatible(value: Any, field: str) -> None:
    try:
        json.dumps(value, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must contain only finite JSON-compatible values") from exc


class LLMProviderError(Exception):
    """Messages may contain secrets; consumers should log the safe code, not str(error)."""

    code = "provider_error"


class ProviderAuthenticationError(LLMProviderError):
    code = "provider_authentication_error"


class ProviderRateLimitError(LLMProviderError):
    code = "provider_rate_limit"


class ProviderTimeoutError(LLMProviderError):
    code = "provider_timeout"


class ProviderCapabilityError(LLMProviderError):
    code = "provider_capability_error"


class InvalidStructuredOutputError(LLMProviderError):
    """Use for invalid JSON or a non-object top-level JSON value."""

    code = "invalid_structured_output"


@runtime_checkable
class LLMProvider(Protocol):
    """Member 4 owns concrete clients, transport retries, credentials, and resource lifecycle."""

    @property
    def name(self) -> str: ...

    @property
    def is_mock(self) -> bool: ...

    async def generate_structured(
        self, request: StructuredGenerationRequest
    ) -> StructuredGenerationResponse: ...
