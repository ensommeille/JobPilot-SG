"""Injectable interface owned by Member 4's form-mapping domain service."""

import asyncio
from typing import Any, Protocol

from app.assistant.mapping import ProfileFormMappingService
from app.assistant.schemas import FormSnapshotField, MappingDraft
from app.llm.config import build_live_provider


class FormMappingGateway(Protocol):
    def map_fields(
        self,
        *,
        form_snapshot: list[FormSnapshotField],
        profile_data: dict[str, Any],
    ) -> MappingDraft: ...


def get_form_mapping_gateway() -> FormMappingGateway:
    return LiveFormMappingGateway()


class LiveFormMappingGateway:
    """M2's synchronous gateway boundary, executed in FastAPI's worker thread."""

    def map_fields(
        self, *, form_snapshot: list[FormSnapshotField], profile_data: dict[str, Any]
    ) -> MappingDraft:
        service = ProfileFormMappingService(provider_factory=build_live_provider)
        return asyncio.run(
            service.map_fields(form_snapshot=form_snapshot, profile_data=profile_data)
        )
