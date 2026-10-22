"""Seed and serve one source-bound review in a separate, loopback-only SQLite workspace.

No existing deployment, user account, or original model artifact is changed. A
script-owned workspace may be resumed, but arbitrary directories are never reused.
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import secrets
import socket
import sys
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID, uuid4

OWNER_KIND = "jobpilot-local-review-workspace-v1"
MARKER = ".jobpilot-review-workspace.json"
REPOSITORY = Path(__file__).resolve().parents[1]


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def digest(value: object) -> str:
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def read_json(path: Path):
    return json.loads(path.read_bytes().decode("utf-8"))


def write_new_json(path: Path, value: object) -> None:
    with path.open("x", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write("\n")


def absolute_path(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute() or path.is_symlink():
        raise argparse.ArgumentTypeError("Use an absolute, non-symlink path")
    return path.resolve()


def web_origin(value: str) -> str:
    parsed = urlparse(value)
    try:
        port = parsed.port
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Invalid web origin port") from exc
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost"}
        or not port
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise argparse.ArgumentTypeError(
            "Use http://127.0.0.1:PORT or http://localhost:PORT"
        )
    return value.rstrip("/")


def loopback_only() -> None:
    """Keep the running API process from connecting to models or other remote hosts."""
    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex
    real_getaddrinfo = socket.getaddrinfo

    def allowed(host: object) -> bool:
        if isinstance(host, bytes):
            host = host.decode("ascii", errors="strict")
        if host == "localhost":
            return True
        try:
            return ipaddress.ip_address(str(host)).is_loopback
        except ValueError:
            return False

    def check(address: object) -> None:
        if not isinstance(address, tuple) or not address or not allowed(address[0]):
            raise OSError("Local review workspace blocks non-loopback network access")

    def connect(sock, address):
        check(address)
        return real_connect(sock, address)

    def connect_ex(sock, address):
        check(address)
        return real_connect_ex(sock, address)

    def getaddrinfo(host, port, *args, **kwargs):
        if not allowed(host):
            raise OSError("Local review workspace blocks remote DNS")
        return real_getaddrinfo(host, port, *args, **kwargs)

    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
    socket.getaddrinfo = getaddrinfo


def configure_process(workspace: Path, origin: str) -> None:
    os.environ["DATABASE_URL"] = (
        "sqlite+pysqlite:///" + (workspace / "local.sqlite").as_posix()
    )
    os.environ["JWT_SECRET_KEY"] = secrets.token_urlsafe(48)
    os.environ["CORS_ORIGINS"] = json.dumps([origin])
    os.environ["EXTENSION_CLIENT_IDS"] = "[]"
    os.environ["EXTENSION_WEB_ORIGINS"] = json.dumps([origin])
    os.environ["JOB_EXTRACTION_LIVE_ENABLED"] = "false"
    os.environ["LLM_API_KEY"] = ""
    os.environ["JOBPILOT_REVIEW_BUNDLE"] = str(workspace / "source-review.json")
    sys.path.insert(0, str(REPOSITORY / "backend"))
    loopback_only()
    import app.llm.config as llm_config
    from app import llm

    def forbid_live_provider(*_args, **_kwargs):
        raise RuntimeError("Live providers are disabled in the local review workspace")

    llm.build_live_provider = forbid_live_provider
    llm_config.build_live_provider = forbid_live_provider


def prepare_workspace(workspace: Path, artifacts: Path) -> bool:
    if (
        workspace == artifacts
        or workspace.is_relative_to(artifacts)
        or artifacts.is_relative_to(workspace)
    ):
        raise ValueError(
            "Workspace and original artifacts must be separate directories"
        )
    expected = {
        "kind": OWNER_KIND,
        "workspace": str(workspace),
        "artifacts": str(artifacts),
    }
    if workspace.exists():
        marker = workspace / MARKER
        if (
            not workspace.is_dir()
            or not marker.is_file()
            or read_json(marker) != expected
        ):
            raise ValueError("Refusing an existing directory not owned by this script")
        for name in ("local.sqlite", "seed.json", "source-review.json"):
            candidate = workspace / name
            if candidate.is_symlink() or not candidate.is_file():
                raise ValueError(
                    "Script-owned workspace is incomplete; use a new workspace"
                )
        return False
    workspace.mkdir()
    write_new_json(workspace / MARKER, expected)
    return True


def seed_workspace(artifacts: Path, workspace: Path, *, port: int, origin: str) -> dict:
    # Read original bytes explicitly: universal-newline conversion would break the
    # manifest's raw-file hash and destroy exact original-result provenance.
    original_text = (artifacts / "result.original.json").read_bytes().decode("utf-8")
    original = json.loads(original_text)
    input_bundle = read_json(artifacts / "input.json")
    item = input_bundle["input"]
    corrected = read_json(artifacts / "extraction.corrected.json")
    manifest = read_json(artifacts / "review.changes.json")
    source_artifact = read_json(artifacts / "source.json")
    original_sha = hashlib.sha256(original_text.encode("utf-8")).hexdigest()
    if manifest["original_live_result_file_sha256"] != original_sha:
        raise ValueError("Original result no longer matches its review manifest")
    fresh = prepare_workspace(workspace, artifacts)
    configure_process(workspace, origin)
    from app.db.base import Base
    from app.db.models import JobExtractionRun, JobPosting, JobSource
    from app.db.session import SessionLocal, engine
    from app.job_extraction.models import (
        ExtractionInput,
        ExtractionResult,
        JobExtractionSchemaV2,
    )
    from sqlalchemy import select

    parsed_input = ExtractionInput.model_validate(item)
    parsed_result = ExtractionResult.model_validate(original)
    JobExtractionSchemaV2.model_validate(corrected)
    expected_hash = parsed_input.input_hash
    if (
        expected_hash != input_bundle["input_hash"]
        or expected_hash != manifest["input_hash"]
        or expected_hash != parsed_result.input_hash
        or parsed_result.source_id != parsed_input.source_id
        or parsed_result.external_id != parsed_input.external_id
        or parsed_result.source_url != parsed_input.source_url
        or parsed_result.execution_mode != "live"
        or parsed_result.status != "needs_review"
    ):
        raise ValueError("Original input/result/review identities do not agree")
    if Path(engine.url.database).resolve() != workspace / "local.sqlite":
        raise ValueError("Database engine is not bound to the isolated workspace")
    if fresh:
        source_id, job_id = uuid4(), uuid4()
        seed = {
            "kind": OWNER_KIND,
            "workspace": str(workspace),
            "artifacts": str(artifacts),
            "job_id": str(job_id),
            "source_id": str(source_id),
            "run_id": original["result_id"],
            "api_origin": f"http://127.0.0.1:{port}",
            "web_origin": origin,
            "database_file": str(workspace / "local.sqlite"),
            "review_bundle_file": str(workspace / "source-review.json"),
            "original_result_file_sha256": original_sha,
            "corrected_sha256": digest(corrected),
            "new_model_calls": 0,
            "seeded_users": 0,
        }
    else:
        seed = read_json(workspace / "seed.json")
        if (
            seed["kind"] != OWNER_KIND
            or seed["original_result_file_sha256"] != original_sha
            or seed["corrected_sha256"] != digest(corrected)
            or seed["api_origin"] != f"http://127.0.0.1:{port}"
            or seed["web_origin"] != origin
            or seed["database_file"] != str(workspace / "local.sqlite")
        ):
            raise ValueError(
                "Refusing to overwrite or change an existing review workspace"
            )
        source_id, job_id = UUID(seed["source_id"]), UUID(seed["job_id"])
    bundle = {
        "kind": "jobpilot-source-review-v1",
        "job_id": str(job_id),
        "source_id": str(source_id),
        "input": item,
        "original_result_text": original_text,
        "corrected_extraction": corrected,
        "corrected_sha256": digest(corrected),
        "review_manifest": manifest,
    }
    if fresh:
        api_url = source_artifact["api_url"]
        suffix = "/jobs/" + parsed_input.external_id
        if not api_url.endswith(suffix):
            raise ValueError("Source API URL is not bound to this external job")
        base_url = api_url[: -len(suffix)]
        source_data = source_artifact["body"]
        pipeline = {
            "kind": "local_source_bound_review_acceptance",
            "source_alias": {
                "database_source_id": str(source_id),
                "original_source_id": parsed_input.source_id,
            },
            "original_pipeline": read_json(artifacts / "pipeline.json"),
            "new_model_calls": 0,
        }
        Base.metadata.create_all(engine)
        with SessionLocal() as db:
            source = JobSource(
                id=source_id,
                name="Stripe - isolated source review",
                source_type=parsed_input.source_type,
                base_url=base_url,
                enabled=True,
            )
            job = JobPosting(
                id=job_id,
                source=source,
                external_id=parsed_input.external_id,
                title=parsed_input.title,
                company=parsed_input.company,
                description=parsed_input.description,
                source_url=parsed_input.source_url,
                apply_url=parsed_input.source_url,
                city=source_data["location"]["name"],
                job_type="internship",
                status="active",
                raw_hash=parsed_input.raw_hash,
                dedup_hash=digest(
                    {
                        "source_id": str(source_id),
                        "external_id": parsed_input.external_id,
                    }
                ),
                posted_at=datetime.fromisoformat(source_data["updated_at"]).date(),
            )
            finished = datetime.fromisoformat(original["finished_at"])
            run = JobExtractionRun(
                id=UUID(original["result_id"]),
                job_id=job_id,
                actor_id=None,
                status=original["status"],
                active_key=None,
                input_hash=expected_hash,
                input_json=item,
                result_json=original,
                pipeline_json=pipeline,
                pipeline_hash=digest(pipeline),
                error_code=original["error_code"],
                started_at=datetime.fromisoformat(original["started_at"]),
                finished_at=finished,
                expires_at=finished + timedelta(days=1),
            )
            db.add_all([source, job])
            db.flush()
            db.add(run)
            db.commit()
        write_new_json(workspace / "source-review.json", bundle)
        write_new_json(workspace / "seed.json", seed)
    else:
        if read_json(workspace / "source-review.json") != bundle:
            raise ValueError("Saved review bundle differs; refusing to overwrite it")
        with SessionLocal() as db:
            job = db.get(JobPosting, job_id)
            run = db.get(JobExtractionRun, UUID(original["result_id"]))
            source = db.scalar(select(JobSource).where(JobSource.id == source_id))
            if (
                job is None
                or source is None
                or run is None
                or job.source_id != source_id
                or run.job_id != job_id
                or run.input_json != item
                or run.result_json != original
            ):
                raise ValueError("Saved database seed differs; refusing to modify it")
    return seed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=absolute_path, required=True)
    parser.add_argument("--workspace", type=absolute_path, required=True)
    parser.add_argument("--port", type=int, default=18521)
    parser.add_argument(
        "--web-origin", type=web_origin, default="http://127.0.0.1:15521"
    )
    parser.add_argument("--seed-only", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("Port must be between 1 and 65535")
    try:
        seed = seed_workspace(
            args.artifacts, args.workspace, port=args.port, origin=args.web_origin
        )
    except (OSError, ValueError, KeyError) as exc:
        print(
            f"Local review workspace refused ({type(exc).__name__}): {exc}",
            file=sys.stderr,
        )
        return 2
    print(json.dumps(seed, ensure_ascii=False, indent=2), flush=True)
    if not args.seed_only:
        import uvicorn
        from app.main import app

        uvicorn.run(app, host="127.0.0.1", port=args.port, reload=False, workers=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
