"""Create/resume a separate local scheduled-source and email-pilot acceptance workspace.

Only --collect-live on a NEW workspace fetches the four explicit public job boards.
The serving API is loopback-only, has no live model capability and can send mail
only to a local .test SMTP sink. This helper never starts that SMTP server itself.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

if __package__:
    from .local_review_workspace import loopback_only, web_origin
else:
    from local_review_workspace import loopback_only, web_origin

REPOSITORY = Path(__file__).resolve().parents[1]
PROGRAMME_FILE = REPOSITORY / "docs/member3/examples/sp-group-email-programme.json"
OWNER_KIND = "jobpilot-local-feature-workspace-v1"
MARKER = ".jobpilot-feature-workspace.json"
SOURCE_KEYS = (
    "ashby-blocktech",
    "ashby-cantina",
    "greenhouse-straitsx",
    "greenhouse-graviton",
)
SOURCE_URLS = (
    "https://api.ashbyhq.com/posting-api/job-board/blocktech",
    "https://api.ashbyhq.com/posting-api/job-board/cantina",
    "https://boards-api.greenhouse.io/v1/boards/straitsx",
    "https://boards-api.greenhouse.io/v1/boards/globalcampus",
)


def absolute_workspace(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        raise argparse.ArgumentTypeError("Workspace must be an absolute path")
    for component in (path, *path.parents):
        if component.is_symlink() or (
            hasattr(component, "is_junction") and component.is_junction()
        ):
            raise argparse.ArgumentTypeError("Workspace cannot traverse symlinks or junctions")
    return path.resolve()


def read_json(path: Path):
    return json.loads(path.read_bytes().decode("utf-8"))


def write_new_json(path: Path, value: dict) -> None:
    with path.open("x", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write("\n")


def digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


def load_programme(path: Path = PROGRAMME_FILE) -> tuple[dict, str]:
    raw = path.read_bytes()
    value = json.loads(raw.decode("utf-8"))
    for field in (
        "company",
        "title",
        "source_url",
        "description",
        "email",
        "evidence",
        "verified_at",
    ):
        if not isinstance(value.get(field), str) or not value[field].strip():
            raise ValueError(f"Official programme snapshot requires {field}")
    if (
        value["company"] != "SP Group"
        or value["source_url"] != "https://www.spgroup.com.sg/about-us/careers"
        or value["email"] != "internship@spgroup.com.sg"
        or value["email"] not in value["evidence"]
    ):
        raise ValueError("Programme must retain the verified SP Group official email channel")
    verified = datetime.fromisoformat(value["verified_at"])
    if verified.tzinfo is None or verified > datetime.now(UTC) + timedelta(minutes=5):
        raise ValueError("Programme verified_at must be an existing timezone-aware observation")
    if len(value["title"]) > 300:
        raise ValueError("Programme title is too long")
    return value, hashlib.sha256(raw).hexdigest()


def prepare_workspace(
    workspace: Path, *, api_port: int, origin: str, smtp_port: int, programme_sha: str
) -> bool:
    expected = {
        "kind": OWNER_KIND,
        "workspace": str(workspace),
        "repository": str(REPOSITORY),
        "api_port": api_port,
        "web_origin": origin,
        "smtp_port": smtp_port,
        "programme_file_sha256": programme_sha,
    }
    if workspace.exists():
        marker = workspace / MARKER
        if (
            not workspace.is_dir()
            or marker.is_symlink()
            or not marker.is_file()
            or read_json(marker) != expected
        ):
            raise ValueError(
                "Refusing an existing directory not owned by this exact helper configuration"
            )
        for filename in ("local.sqlite", "seed.json"):
            candidate = workspace / filename
            if not candidate.is_file() or candidate.is_symlink() or candidate.stat().st_nlink != 1:
                raise ValueError("Owned workspace is incomplete or linked; use a fresh directory")
        return False
    workspace.mkdir()
    write_new_json(workspace / MARKER, expected)
    return True


def configure_process(workspace: Path, origin: str, smtp_port: int) -> None:
    """Configure only this helper process; do not apply network blocking before opt-in GETs."""
    if "app.db.session" in sys.modules:
        raise ValueError(
            "Run this helper in a fresh Python process, not an already initialized API"
        )
    os.environ["DATABASE_URL"] = "sqlite+pysqlite:///" + (workspace / "local.sqlite").as_posix()
    os.environ["JWT_SECRET_KEY"] = secrets.token_urlsafe(48)
    os.environ["CORS_ORIGINS"] = json.dumps([origin])
    os.environ["EXTENSION_CLIENT_IDS"] = "[]"
    os.environ["EXTENSION_WEB_ORIGINS"] = json.dumps([origin])
    os.environ["JOB_EXTRACTION_LIVE_ENABLED"] = "false"
    for name in (
        "LLM_API_KEY",
        "OPENAI_API_KEY",
        "DEEPSEEK_API_KEY",
        "QWEN_API_KEY",
        "DASHSCOPE_API_KEY",
    ):
        os.environ[name] = ""
    os.environ.pop("JOBPILOT_REVIEW_BUNDLE", None)
    os.environ["JOBPILOT_EMAIL_MODE"] = "test_smtp"
    os.environ["JOBPILOT_TEST_SMTP_HOST"] = "127.0.0.1"
    os.environ["JOBPILOT_TEST_SMTP_PORT"] = str(smtp_port)
    os.environ["JOBPILOT_TEST_SMTP_RECIPIENT"] = "applications@jobpilot.test"
    sys.path.insert(0, str(REPOSITORY / "backend"))
    import app.llm.config as llm_config
    from app import llm
    from app.llm.contracts import ProviderCapabilityError

    def forbid_live_provider(*_args, **_kwargs):
        raise ProviderCapabilityError("Live models are disabled in the local feature workspace")

    llm.build_live_provider = forbid_live_provider
    llm_config.build_live_provider = forbid_live_provider


def seed_workspace(
    workspace: Path,
    *,
    api_port: int,
    origin: str,
    smtp_port: int,
    collect_live: bool = False,
) -> dict:
    programme, programme_sha = load_programme()
    fresh = prepare_workspace(
        workspace,
        api_port=api_port,
        origin=origin,
        smtp_port=smtp_port,
        programme_sha=programme_sha,
    )
    configure_process(workspace, origin, smtp_port)
    from sqlalchemy import select

    from app.core.security import hash_password
    from app.db.base import Base
    from app.db.models import JobPosting, JobSource, User, UserRole
    from app.db.session import SessionLocal, engine
    from app.email_applications.models import EmailApplicationPolicy
    from app.ingestion.scheduler import register_catalog_sources, run_due_sources
    from app.ingestion.source_catalog import catalog_source

    if Path(engine.url.database).resolve() != workspace / "local.sqlite":
        raise ValueError("Database engine is not bound to the isolated workspace")
    if not fresh:
        seed = read_json(workspace / "seed.json")
        if (
            seed.get("kind") != OWNER_KIND
            or seed.get("programme_file_sha256") != programme_sha
            or seed.get("api_origin") != f"http://127.0.0.1:{api_port}"
            or seed.get("web_origin") != origin
            or seed.get("smtp_port") != smtp_port
        ):
            raise ValueError("Saved seed does not match this helper configuration")
        if collect_live and not seed.get("live_collection", {}).get("requested"):
            raise ValueError(
                "Resuming never adds collection or overwrites seed data; use a new workspace for --collect-live"
            )
        with SessionLocal() as db:
            admin = db.get(User, UUID(seed["admin_id"]))
            job = db.get(JobPosting, UUID(seed["sp_job_id"]))
            policy = db.get(EmailApplicationPolicy, UUID(seed["sp_job_id"]))
            sources = [db.get(JobSource, UUID(value)) for value in seed["source_ids"]]
            if (
                admin is None
                or admin.role != UserRole.ADMIN
                or job is None
                or policy is None
                or any(source is None for source in sources)
            ):
                raise ValueError("Owned workspace seed is incomplete; refusing to change it")
        return seed

    for key, url in zip(SOURCE_KEYS, SOURCE_URLS, strict=True):
        if catalog_source(key).base_url != url:
            raise ValueError("Reviewed catalogue identity changed; refusing unexpected collection")
    Base.metadata.create_all(engine)
    verified_at = datetime.fromisoformat(programme["verified_at"])
    with SessionLocal() as db:
        admin = User(
            email="local-feature-bootstrap@jobpilot.test",
            password_hash=hash_password(secrets.token_urlsafe(48)),
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add(admin)
        db.commit()
        sources = register_catalog_sources(db, actor=admin, keys=SOURCE_KEYS)
        official = JobSource(
            name="SP Group - verified internship email programme",
            source_type="curated",
            base_url=programme["source_url"],
            schedule="manual",
            enabled=True,
            status="healthy",
            last_success_at=verified_at,
        )
        job = JobPosting(
            source=official,
            external_id="sp-group-internship-programme",
            title=programme["title"],
            company=programme["company"],
            city="Singapore",
            job_type="internship programme",
            description=programme["description"],
            source_url=programme["source_url"],
            apply_url=programme["source_url"],
            status="active",
            raw_hash=digest(programme),
            dedup_hash=digest({"kind": "official-email-programme", "url": programme["source_url"]}),
        )
        db.add(job)
        db.flush()
        db.add(
            EmailApplicationPolicy(
                job_id=job.id,
                email=programme["email"],
                source_url=programme["source_url"],
                evidence=programme["evidence"],
                verified_at=verified_at,
                enabled=True,
            )
        )
        sandbox = JobSource(
            name="TEST ONLY - negative email policy fixtures",
            source_type="sandbox",
            base_url="https://negative-fixture.jobpilot.test",
            schedule="manual",
            enabled=False,
            status="test_only",
        )
        db.add(sandbox)
        negative_ids = {}
        for key, enabled in (("closed_expired", True), ("disabled_policy", False)):
            negative = JobPosting(
                source=sandbox,
                external_id=key,
                title=f"TEST ONLY - {key} email rejection fixture",
                company="Fictitious Test Employer",
                description="Negative acceptance fixture, not a real vacancy or application channel.",
                source_url=sandbox.base_url + "/" + key,
                apply_url=sandbox.base_url,
                status="closed",
                deadline=verified_at.date() - timedelta(days=1),
                raw_hash=digest({"test": key}),
                dedup_hash=digest({"negative_fixture": key}),
            )
            db.add(negative)
            db.flush()
            db.add(
                EmailApplicationPolicy(
                    job_id=negative.id,
                    email="applications@jobpilot.test",
                    source_url=negative.source_url,
                    evidence="TEST ONLY - local negative fixture; not an employer application channel.",
                    verified_at=verified_at,
                    enabled=enabled,
                )
            )
            negative_ids[key] = str(negative.id)
        db.commit()
        source_ids = [str(source.id) for source in sources]
        due_source_ids = {
            str(value)
            for value in db.scalars(
                select(JobSource.id).where(
                    JobSource.enabled.is_(True),
                    JobSource.schedule.in_(("every:6h", "every:24h")),
                )
            )
        }
        if due_source_ids != set(source_ids):
            raise ValueError("Only the four explicit boards may be scheduled for collection")
        reports = run_due_sources(db, actor=admin, limit=4) if collect_live else []
        seed = {
            "kind": OWNER_KIND,
            "workspace": str(workspace),
            "sp_job_id": str(job.id),
            "sp_source_id": str(official.id),
            "source_ids": source_ids,
            "source_keys": list(SOURCE_KEYS),
            "admin_id": str(admin.id),
            "api_origin": f"http://127.0.0.1:{api_port}",
            "web_origin": origin,
            "smtp_port": smtp_port,
            "actual_recipient": "applications@jobpilot.test",
            "programme_file_sha256": programme_sha,
            "programme_verified_at": programme["verified_at"],
            "negative_job_ids": negative_ids,
            "live_collection": {"requested": collect_live, "reports": reports},
            "new_model_calls": 0,
            "employer_emails_sent": 0,
        }
    write_new_json(workspace / "seed.json", seed)
    return seed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=absolute_workspace, required=True)
    parser.add_argument("--api-port", type=int, default=18523)
    parser.add_argument("--web-origin", type=web_origin, default="http://127.0.0.1:15523")
    parser.add_argument("--smtp-port", type=int, default=1027)
    parser.add_argument(
        "--collect-live",
        action="store_true",
        help="On a NEW workspace only: perform one real public-GET collection for the four explicit boards",
    )
    parser.add_argument("--seed-only", action="store_true")
    arguments = parser.parse_args(argv)
    if (
        not all(1 <= port <= 65535 for port in (arguments.api_port, arguments.smtp_port))
        or arguments.api_port == arguments.smtp_port
    ):
        parser.error("API and SMTP ports must be distinct values between 1 and 65535")
    try:
        seed = seed_workspace(
            arguments.workspace,
            api_port=arguments.api_port,
            origin=arguments.web_origin,
            smtp_port=arguments.smtp_port,
            collect_live=arguments.collect_live,
        )
    except (OSError, ValueError, KeyError) as exc:
        print(
            f"Local feature workspace refused ({type(exc).__name__}): {exc}",
            file=sys.stderr,
        )
        return 2
    print(json.dumps(seed, ensure_ascii=False, indent=2), flush=True)
    # No external networking remains possible after the one explicit seeding phase.
    loopback_only()
    if not arguments.seed_only:
        import uvicorn

        from app.main import app

        uvicorn.run(app, host="127.0.0.1", port=arguments.api_port, reload=False, workers=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
