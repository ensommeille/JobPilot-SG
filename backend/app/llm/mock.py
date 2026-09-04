"""A deterministic test double, not an AI model or a simulated accuracy benchmark."""

from __future__ import annotations

from collections.abc import Iterable

from .contracts import LLMProviderError, StructuredGenerationRequest, StructuredGenerationResponse


class MockProviderExhausted(LLMProviderError):
    code = "mock_responses_exhausted"


class MockProvider:
    name = "mock"
    is_mock = True

    def __init__(self, outcomes: Iterable[StructuredGenerationResponse | Exception]) -> None:
        self._outcomes = iter(outcomes)
        self.requests: list[StructuredGenerationRequest] = []

    async def generate_structured(
        self, request: StructuredGenerationRequest
    ) -> StructuredGenerationResponse:
        self.requests.append(request.model_copy(deep=True))
        try:
            outcome = next(self._outcomes)
        except StopIteration as exc:
            raise MockProviderExhausted("No scripted outcome remains") from exc
        if isinstance(outcome, Exception):
            raise outcome
        return outcome.model_copy(
            deep=True, update={"provider": "mock", "model": "scripted-fixture-v1"}
        )
