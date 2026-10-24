from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.ai_recommendations.router import router as ai_recommendations_router
from app.application_journey.router import router as application_journey_router
from app.applications.router import router as applications_router
from app.assistant.router import router as assistant_router
from app.auth.extension_router import router as extension_auth_router
from app.auth.router import auth_router, users_router
from app.autofill_assistant import router as autofill_assistant_router
from app.browser_assistant import router as browser_assistant_router
from app.core.config import get_settings
from app.email_applications.router import router as email_applications_router
from app.ingestion.router import router as ingestion_router
from app.job_extraction.router import router as extraction_router
from app.job_matching import router as matching_router
from app.job_recommendations import router as recommendations_router
from app.jobs.router import router as jobs_router
from app.jobs.source_status import router as source_status_router
from app.profiles.router import router as profiles_router

settings = get_settings()
app = FastAPI(title=settings.app_name, version=settings.app_version)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(ai_recommendations_router)
app.include_router(extension_auth_router)
app.include_router(users_router)
app.include_router(jobs_router)
app.include_router(source_status_router)
app.include_router(email_applications_router)
app.include_router(recommendations_router)
app.include_router(matching_router)
app.include_router(profiles_router)
app.include_router(applications_router)
app.include_router(application_journey_router)
app.include_router(assistant_router)
app.include_router(ingestion_router)
app.include_router(extraction_router)
app.include_router(browser_assistant_router)
app.include_router(autofill_assistant_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
