"""Alibaba Cloud Qwen provider adapter for the shared JobPilot LLM contract."""

from __future__ import annotations

import httpx

from .openai_compatible import OpenAICompatibleChatProvider


class QwenProvider(OpenAICompatibleChatProvider):
    """Qwen adapter using Alibaba Cloud Model Studio's OpenAI-compatible chat API."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str = "qwen3.8-flash",
        timeout_seconds: float = 30.0,
        max_retries: int = 2,
        retry_backoff_seconds: float = 0.25,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(
            name="qwen",
            api_key=api_key,
            base_url=base_url,
            model=model,
            timeout_seconds=timeout_seconds,
            max_retries=max_retries,
            retry_backoff_seconds=retry_backoff_seconds,
            client=client,
        )
