"""HTTP routes for application forms, mapping delegation, and confirmed persistence."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.applications.service import ApplicationConflictError
from app.assistant.gateway import FormMappingGateway, get_form_mapping_gateway
from app.assistant.schemas import (
    ApplicationFormRead,
    ApplicationFormSummary,
    AssistantApplicationCreate,
    AssistantApplicationRead,
    AssistantBootstrap,
    FormMapRequest,
    MappingDraft,
    MappingRecordRead,
)
from app.assistant.service import (
    AssistantConfirmationError,
    create_assistant_application,
    get_form,
    get_mapping,
    list_fixture_forms,
    profile_snapshot,
    validate_snapshot,
)
from app.auth.dependencies import CurrentUser
from app.db.session import get_db

router = APIRouter(prefix="/assistant", tags=["assistant"])
DatabaseSession = Annotated[Session, Depends(get_db)]
MappingGateway = Annotated[FormMappingGateway, Depends(get_form_mapping_gateway)]


@router.get("/bootstrap", response_model=AssistantBootstrap)
def read_bootstrap(db: DatabaseSession) -> AssistantBootstrap:
    return AssistantBootstrap(
        api_version="v1",
        mapping_contract_version="v1",
        manual_fallback=True,
        forms=[ApplicationFormSummary.model_validate(item) for item in list_fixture_forms(db)],
    )


@router.get("/forms/{form_id}", response_model=ApplicationFormRead)
def read_form(form_id: UUID, db: DatabaseSession) -> ApplicationFormRead:
    form = get_form(db, form_id)
    if form is None:
        raise HTTPException(status_code=404, detail="Application form not found")
    return ApplicationFormRead.model_validate(form)


@router.post("/map-fields", response_model=MappingDraft)
def map_fields(
    payload: FormMapRequest,
    db: DatabaseSession,
    current_user: CurrentUser,
    gateway: MappingGateway,
) -> MappingDraft:
    form = get_form(db, payload.form_id)
    if form is None:
        raise HTTPException(status_code=404, detail="Application form not found")
    try:
        validate_snapshot(form, {item.field_id for item in payload.form_snapshot})
    except AssistantConfirmationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return gateway.map_fields(
        form_snapshot=payload.form_snapshot,
        profile_data=profile_snapshot(db, user=current_user),
    )


@router.post(
    "/applications",
    response_model=AssistantApplicationRead,
    status_code=status.HTTP_201_CREATED,
)
def persist_assistant_application(
    payload: AssistantApplicationCreate,
    db: DatabaseSession,
    current_user: CurrentUser,
) -> AssistantApplicationRead:
    form = get_form(db, payload.form_id)
    if form is None:
        raise HTTPException(status_code=404, detail="Application form not found")
    try:
        application, mapping = create_assistant_application(
            db, user=current_user, form=form, payload=payload
        )
    except AssistantConfirmationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ApplicationConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return AssistantApplicationRead.model_validate(
        {"application": application, "mapping": mapping}
    )


@router.get("/mappings/{mapping_id}", response_model=MappingRecordRead)
def read_mapping(
    mapping_id: UUID, db: DatabaseSession, current_user: CurrentUser
) -> MappingRecordRead:
    mapping = get_mapping(db, user=current_user, mapping_id=mapping_id)
    if mapping is None:
        raise HTTPException(status_code=404, detail="Mapping record not found")
    return MappingRecordRead.model_validate(mapping)
