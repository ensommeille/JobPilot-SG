"""Disposable-seed guard tests: controlled Session/adapter objects, no network or DB."""

import importlib.util
import json
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.db.models import Application, JobExtractionRun, JobPosting, JobSource, User
from app.job_extraction.models import ExtractionInput
from app.job_extraction.quality import assess_quality
from tests.test_semantic_matching import schema

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/seed_semantics_acceptance.py"
spec = importlib.util.spec_from_file_location("semantic_disposable_seed", SCRIPT)
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)


class ControlledSession:
    def __init__(self):
        self.dialect = "postgresql"
        self.sources = [SimpleNamespace(name="JobPilot Sandbox", source_type="sandbox")]
        self.counts = {
            User.__tablename__: 1,
            JobPosting.__tablename__: 2,
            JobExtractionRun.__tablename__: 0,
            Application.__tablename__: 0,
        }
        self.added = []
        self.committed = False
        self.exited_with_error = False

    def __enter__(self):
        return self

    def __exit__(self, kind, _value, _trace):
        self.exited_with_error = kind is not None

    def scalars(self, _statement):
        return self.sources

    def scalar(self, statement):
        return self.counts[statement.get_final_froms()[0].name]

    def get_bind(self):
        return SimpleNamespace(dialect=SimpleNamespace(name=self.dialect))

    def add(self, item):
        self.added.append(item)

    def flush(self):
        for item in self.added:
            if item.id is None:
                item.id = uuid4()

    def commit(self):
        self.committed = True


class ControlledAdapter:
    def __init__(self, _config):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        pass

    def parse_job_detail(self, html, url):
        assert html == "controlled fixture, no HTTP"
        return SimpleNamespace(
            external_id="controlled-fixture",
            title="Synthetic software intern",
            company="Fictional acceptance company",
            description="Python required.",
            source_url=url,
            apply_url=None,
            city=None,
            job_type=[],
            posted_at=None,
            deadline=None,
            status=SimpleNamespace(value="active"),
            raw_hash="a" * 64,
            dedup_hash="b" * 64,
        )


def bundle():
    source = ExtractionInput(
        source_id="original-controlled-source",
        external_id="controlled-fixture",
        source_url="https://www.internsg.com/job/controlled-fixture/",
        source_type="html",
        title="Synthetic software intern",
        company="Fictional acceptance company",
        description="Python required.",
        raw_hash="a" * 64,
    )
    data = schema()
    now = datetime.now(UTC).isoformat()
    result = {
        "result_id": str(uuid4()),
        "source_id": source.source_id,
        "external_id": source.external_id,
        "source_url": source.source_url,
        "input_hash": source.input_hash,
        "schema_version": "job-extraction-v2",
        "prompt_version": "job-extraction-prompt-v2",
        "contract_version": "0.1.0",
        "execution_mode": "live",
        "status": "needs_review",
        "extraction": data.model_dump(),
        "quality": assess_quality(data, source.description).model_dump(),
        "attempts": [
            {
                "attempt": 1,
                "request_id": "offline-controlled-test-artifact",
                "outcome": "success",
                "duration_ms": 1,
                "provider": "controlled-test-double",
            }
        ],
        "started_at": now,
        "finished_at": now,
    }
    return {
        "kind": "actual-model-artifacts-for-disposable-acceptance",
        "cases": [
            {
                "id": "synthetic_case",
                "input": source.model_dump(),
                "html": "controlled fixture, no HTTP",
                "result": result,
            }
        ],
    }


def run(monkeypatch, tmp_path, payload, session, *, marker=True):
    path = tmp_path / "controlled-seed-bundle.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr("sys.argv", [str(SCRIPT), "--bundle", str(path)])
    if marker:
        monkeypatch.setenv("JOBPILOT_ACCEPTANCE_ONLY", "fresh-disposable-database")
    else:
        monkeypatch.delenv("JOBPILOT_ACCEPTANCE_ONLY", raising=False)
    monkeypatch.setattr(seed, "SessionLocal", lambda: session)
    monkeypatch.setattr(seed, "InternSGAdapter", ControlledAdapter)
    seed.main()
    return path


def test_missing_disposable_marker_refuses_before_any_mutation(monkeypatch, tmp_path):
    session = ControlledSession()
    with pytest.raises(SystemExit, match="marker missing"):
        run(monkeypatch, tmp_path, bundle(), session, marker=False)
    assert session.added == [] and not session.committed


def test_wrong_bundle_kind_refuses_before_any_mutation(monkeypatch, tmp_path):
    payload = bundle()
    payload["kind"] = "other"
    session = ControlledSession()
    with pytest.raises(SystemExit, match="unexpected acceptance bundle"):
        run(monkeypatch, tmp_path, payload, session)
    assert session.added == [] and not session.committed


@pytest.mark.parametrize(
    "change",
    ["sqlite", "extra_source", "wrong_name", "wrong_type", "users", "jobs", "runs", "applications"],
)
def test_nonfresh_or_other_database_shape_is_refused(monkeypatch, tmp_path, change):
    session = ControlledSession()
    if change == "sqlite":
        session.dialect = "sqlite"
    elif change == "extra_source":
        session.sources.append(SimpleNamespace(name="Other", source_type="html"))
    elif change == "wrong_name":
        session.sources[0].name = "Existing project source"
    elif change == "wrong_type":
        session.sources[0].source_type = "html"
    else:
        table = {
            "users": User,
            "jobs": JobPosting,
            "runs": JobExtractionRun,
            "applications": Application,
        }[change]
        session.counts[table.__tablename__] += 1
    with pytest.raises(SystemExit, match="not a fresh PostgreSQL demo seed"):
        run(monkeypatch, tmp_path, bundle(), session)
    assert session.added == [] and not session.committed


def test_model_input_hash_mismatch_is_never_committed(monkeypatch, tmp_path):
    payload = bundle()
    payload["cases"][0]["result"]["input_hash"] = "0" * 64
    session = ControlledSession()
    with pytest.raises(SystemExit, match="artifact/input hash mismatch"):
        run(monkeypatch, tmp_path, payload, session)
    assert not session.committed and session.exited_with_error


@pytest.mark.parametrize("change", ["source_id", "external_id", "source_url", "mock", "failed"])
def test_misidentified_or_nonlive_artifact_is_never_committed(monkeypatch, tmp_path, change):
    payload = bundle()
    result = payload["cases"][0]["result"]
    if change == "mock":
        result["execution_mode"] = "mock"
    elif change == "failed":
        result.update(status="failed", extraction=None, quality=None, error_code="provider_error")
    else:
        result[change] = (
            "https://www.internsg.com/job/a-different-source/"
            if change == "source_url"
            else "different-artifact-identity"
        )
    session = ControlledSession()
    with pytest.raises(SystemExit, match="artifact/input hash mismatch"):
        run(monkeypatch, tmp_path, payload, session)
    assert not session.committed and session.exited_with_error


def test_success_rebinds_only_envelope_and_retains_artifact_payload(monkeypatch, tmp_path, capsys):
    payload = bundle()
    original = payload["cases"][0]["result"]
    session = ControlledSession()
    path = run(monkeypatch, tmp_path, payload, session)
    record = next(item for item in session.added if isinstance(item, JobExtractionRun))
    source = next(item for item in session.added if isinstance(item, JobSource))
    assert session.committed
    assert record.result_json["extraction"] == original["extraction"]
    assert record.result_json["quality"] == original["quality"]
    assert record.result_json["attempts"][0]["request_id"] == original["attempts"][0]["request_id"]
    assert record.result_json["started_at"] == original["started_at"]
    assert record.result_json["result_id"] == original["result_id"]
    assert record.result_json["source_id"] == str(source.id) != original["source_id"]
    rebound_input = ExtractionInput.model_validate(record.input_json)
    assert record.input_hash == record.result_json["input_hash"] == rebound_input.input_hash
    assert record.pipeline_json["new_model_calls"] == 0
    assert record.pipeline_json["original_input_hash"] == original["input_hash"]
    assert "replayed_actual_live_artifact" in record.pipeline_json["kind"]
    assert json.loads(path.read_text(encoding="utf-8")) == payload
    assert json.loads(capsys.readouterr().out)["new_model_calls"] == 0
