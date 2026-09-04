"""Public, source-neutral LLM contract for all JobPilot consumers."""

from .contracts import (
    CONTRACT_VERSION,
    InvalidStructuredOutputError,
    LLMProvider,
    LLMProviderError,
    Message,
    ProviderAuthenticationError,
    ProviderCapabilityError,
    ProviderRateLimitError,
    ProviderTimeoutError,
    StructuredGenerationRequest,
    StructuredGenerationResponse,
    TokenUsage,
)
from .mock import MockProvider

__all__ = [
    "CONTRACT_VERSION",
    "InvalidStructuredOutputError",
    "LLMProvider",
    "LLMProviderError",
    "Message",
    "MockProvider",
    "ProviderAuthenticationError",
    "ProviderCapabilityError",
    "ProviderRateLimitError",
    "ProviderTimeoutError",
    "StructuredGenerationRequest",
    "StructuredGenerationResponse",
    "TokenUsage",
]
