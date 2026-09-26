"""Environment-backed configuration and factory for concrete LLM providers."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from .contracts import (
    LLMProvider,
    ProviderAuthenticationError,
    ProviderCapabilityError,
)
from .deepseek import DeepSeekProvider
from .qwen import QwenProvider


class LLMSettings(BaseSettings):
    """Configuration loaded from LLM_* environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="LLM_",
        extra="ignore",
        case_sensitive=False,
    )

    provider: Literal["qwen", "deepseek"] = "deepseek"
    api_key: SecretStr | None = None
    base_url: str | None = None
    model: str | None = None
    timeout_seconds: float = Field(default=30.0, gt=0, le=60)
    max_retries: int = Field(default=2, ge=0, le=5)
    retry_backoff_seconds: float = Field(default=0.25, ge=0, le=5)


def build_live_provider(settings: LLMSettings | None = None) -> LLMProvider:
    """Build one live provider without exposing credentials to business modules."""

    config = settings or LLMSettings()
    if config.api_key is None or not config.api_key.get_secret_value().strip():
        raise ProviderAuthenticationError("LLM_API_KEY is not configured")
    api_key = config.api_key.get_secret_value()

    common = {
        "api_key": api_key,
        "timeout_seconds": config.timeout_seconds,
        "max_retries": config.max_retries,
        "retry_backoff_seconds": config.retry_backoff_seconds,
    }
    if config.provider == "deepseek":
        return DeepSeekProvider(
            base_url=config.base_url or "https://api.deepseek.com",
            model=config.model or "deepseek-v4-flash",
            **common,
        )

    if not config.base_url:
        raise ProviderCapabilityError(
            "Qwen requires LLM_BASE_URL for the selected Alibaba Cloud workspace/region"
        )
    return QwenProvider(
        base_url=config.base_url,
        model=config.model or "qwen3.8-flash",
        **common,
    )
