from fastapi import FastAPI

from app.applications.router import router as applications_router
from app.assistant.router import router as assistant_router
from app.auth.router import auth_router, users_router
from app.core.config import get_settings
from app.jobs.router import router as jobs_router
from app.profiles.router import router as profiles_router

settings = get_settings()
app = FastAPI(title=settings.app_name, version=settings.app_version)
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(jobs_router)
app.include_router(profiles_router)
app.include_router(applications_router)
app.include_router(assistant_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
