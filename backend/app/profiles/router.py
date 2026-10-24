"""HTTP routes for the authenticated user's profile and resume metadata."""

from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.formparsers import MultiPartException

from app.auth.dependencies import BrowserUser, CurrentUser
from app.db.session import get_db
from app.profiles.resume_files import (
    MAX_BYTES,
    create_file,
    owned_resume,
    resume_detail,
    stored_attachment,
)
from app.profiles.schemas import (
    LocalProfileImport,
    ProfileRead,
    ProfileUpdate,
    ResumeCreate,
    ResumeRead,
)
from app.profiles.service import (
    add_resume_metadata,
    get_profile,
    import_local_profile,
    list_resume_metadata,
    update_profile,
)


class PrivateProfileRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def private_handler(request: Request):
            limit_detail = "Resume upload body exceeds the 2 MiB file limit"
            try:
                if request.url.path.endswith("/profile/resumes/upload"):
                    maximum = MAX_BYTES + 65536  # bounded multipart overhead, not just file.read
                    length = request.headers.get("content-length")
                    if length is not None and (not length.isdecimal() or int(length) > maximum):
                        raise HTTPException(413, limit_detail)
                    receive = request._receive
                    total = 0

                    async def bounded_receive():
                        nonlocal total
                        message = await receive()
                        total += len(message.get("body", b""))
                        if total > maximum:
                            # This exception makes the multipart parser close open spool files.
                            raise MultiPartException(limit_detail)
                        return message

                    request._receive = bounded_receive
                response = await handler(request)
            except RequestValidationError as exc:
                response = await request_validation_exception_handler(request, exc)
            except StarletteHTTPException as exc:
                if exc.detail == limit_detail:
                    raise HTTPException(
                        413, limit_detail, headers={"Cache-Control": "no-store"}
                    ) from exc
                exc.headers = {**(exc.headers or {}), "Cache-Control": "no-store"}
                raise
            response.headers["Cache-Control"] = "no-store"
            return response

        return private_handler


router = APIRouter(prefix="/profile", tags=["profile"], route_class=PrivateProfileRoute)
DatabaseSession = Annotated[Session, Depends(get_db)]


@router.post("/import-local")
def import_local(
    payload: LocalProfileImport, db: DatabaseSession, current_user: BrowserUser
) -> dict:
    return import_local_profile(db, user=current_user, payload=payload)


@router.get("", response_model=ProfileRead)
def read_profile(response: Response, db: DatabaseSession, current_user: CurrentUser) -> ProfileRead:
    response.headers["Cache-Control"] = "no-store"
    return ProfileRead.model_validate(get_profile(db, user=current_user))


@router.put("", response_model=ProfileRead)
def replace_profile(
    payload: ProfileUpdate, response: Response, db: DatabaseSession, current_user: CurrentUser
) -> ProfileRead:
    response.headers["Cache-Control"] = "no-store"
    return ProfileRead.model_validate(update_profile(db, user=current_user, payload=payload))


@router.post("/resumes", response_model=ResumeRead, status_code=status.HTTP_201_CREATED)
def create_resume_metadata(
    payload: ResumeCreate, db: DatabaseSession, current_user: CurrentUser
) -> ResumeRead:
    return ResumeRead.model_validate(add_resume_metadata(db, user=current_user, payload=payload))


@router.get("/resumes", response_model=list[ResumeRead])
def read_resume_metadata(db: DatabaseSession, current_user: CurrentUser) -> list[ResumeRead]:
    return [ResumeRead.model_validate(item) for item in list_resume_metadata(db, user=current_user)]


@router.post("/resumes/upload", response_model=ResumeRead, status_code=201)
def upload_resume(
    file: Annotated[UploadFile, File()], db: DatabaseSession, current_user: CurrentUser
) -> ResumeRead:
    try:
        if file.content_type != "application/pdf":
            raise HTTPException(422, "Upload a PDF with content type application/pdf")
        raw = file.file.read(MAX_BYTES + 1)
        document = create_file(db, current_user, file.filename or "", raw)
        return ResumeRead.model_validate(document)
    finally:
        file.file.close()


@router.get("/resumes/{resume_id}")
def read_resume(resume_id: UUID, db: DatabaseSession, current_user: CurrentUser) -> dict:
    return resume_detail(db, current_user, resume_id)


@router.get("/resumes/{resume_id}/content")
def download_resume(resume_id: UUID, db: DatabaseSession, current_user: CurrentUser) -> Response:
    filename, content = stored_attachment(db, current_user, resume_id)
    return Response(
        content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": "attachment; filename=\"resume.pdf\"; filename*=UTF-8''"
            + quote(filename, safe=""),
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
        },
    )


@router.delete("/resumes/{resume_id}", status_code=204)
def delete_resume(resume_id: UUID, db: DatabaseSession, current_user: CurrentUser) -> Response:
    document, file = owned_resume(db, current_user, resume_id)
    if file is not None:
        db.delete(file)
    db.delete(document)
    db.commit()
    return Response(status_code=204)
