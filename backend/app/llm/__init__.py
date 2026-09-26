"""Public, source-neutral LLM contract for all JobPilot consumers."""

from .config import LLMSettings, build_live_provider
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
from .deepseek import DeepSeekProvider
from .mock import MockProvider
from .qwen import QwenProvider

__all__ = [
    "CONTRACT_VERSION",
    "DeepSeekProvider",
    "InvalidStructuredOutputError",
    "LLMProvider",
    "LLMProviderError",
    "LLMSettings",
    "Message",
    "MockProvider",
    "ProviderAuthenticationError",
    "ProviderCapabilityError",
    "ProviderRateLimitError",
    "ProviderTimeoutError",
    "QwenProvider",
    "StructuredGenerationRequest",
    "StructuredGenerationResponse",
    "TokenUsage",
    "build_live_provider",
]
