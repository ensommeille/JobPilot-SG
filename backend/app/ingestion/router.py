"""Admin routes for source configuration and observable crawl runs."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth.dependencies import AdminUser
from app.db.session import get_db
from app.ingestion.schemas import (
    CrawlRunPage,
    CrawlRunRead,
    SourceCreate,
    SourceRead,
    SourceRunRequest,
)
from app.ingestion.service import (
    SourceAdapterFactory,
    SourceConflictError,
    SourceRunError,
    create_source,
    get_crawl_run,
    get_source,
    get_source_adapter_factory,
    list_crawl_runs,
    list_sources,
    run_source,
)

router = APIRouter(tags=["admin-ingestion"])
DatabaseSession = Annotated[Session, Depends(get_db)]
AdapterFactory = Annotated[SourceAdapterFactory, Depends(get_source_adapter_factory)]


@router.get("/sources", response_model=list[SourceRead])
def read_sources(db: DatabaseSession, _admin: AdminUser) -> list[SourceRead]:
    return [SourceRead.model_validate(source) for source in list_sources(db)]


@router.post("/sources", response_model=SourceRead, status_code=status.HTTP_201_CREATED)
def create_job_source(
    payload: SourceCreate, db: DatabaseSession, admin: AdminUser
) -> SourceRead:
    try:
        source = create_source(db, payload=payload, actor=admin)
    except SourceConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return SourceRead.model_validate(source)


@router.post(
    "/sources/{source_id}/run",
    response_model=CrawlRunRead,
    status_code=status.HTTP_201_CREATED,
)
def create_crawl_run(
    source_id: UUID,
    payload: SourceRunRequest,
    db: DatabaseSession,
    admin: AdminUser,
    adapter_factory: AdapterFactory,
) -> CrawlRunRead:
    source = get_source(db, source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")
    try:
        crawl_run = run_source(
            db,
            source=source,
            actor=admin,
            adapter_factory=adapter_factory,
            max_links=payload.max_links,
            max_details=payload.max_details,
        )
    except SourceRunError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return CrawlRunRead.model_validate(crawl_run)


@router.get("/runs", response_model=CrawlRunPage)
def read_crawl_runs(
    db: DatabaseSession,
    _admin: AdminUser,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> CrawlRunPage:
    items, total, pages = list_crawl_runs(db, page=page, page_size=page_size)
    return CrawlRunPage(
        items=[CrawlRunRead.model_validate(item) for item in items],
        page=page,
        page_size=page_size,
        total=total,
        pages=pages,
    )


@router.get("/runs/{run_id}", response_model=CrawlRunRead)
def read_crawl_run(
    run_id: UUID, db: DatabaseSession, _admin: AdminUser
) -> CrawlRunRead:
    crawl_run = get_crawl_run(db, run_id)
    if crawl_run is None:
        raise HTTPException(status_code=404, detail="Crawl run not found")
    return CrawlRunRead.model_validate(crawl_run)
