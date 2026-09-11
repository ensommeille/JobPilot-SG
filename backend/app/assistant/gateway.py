"""Injectable interface owned by Member 4's form-mapping domain service."""

from typing import Any, Protocol

from fastapi import HTTPException, status

from app.assistant.schemas import FormSnapshotField, MappingDraft


class FormMappingGateway(Protocol):
    def map_fields(
        self,
        *,
        form_snapshot: list[FormSnapshotField],
        profile_data: dict[str, Any],
    ) -> MappingDraft: ...


def get_form_mapping_gateway() -> FormMappingGateway:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Form mapping service is not configured; use manual entry",
    )
