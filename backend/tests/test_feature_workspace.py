"""Guard and offline reproducibility checks for the explicitly local feature helper."""

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "scripts/local_feature_workspace.py"


def run_helper(workspace: Path, *arguments: str):
    return subprocess.run(
        [sys.executable, str(HELPER), "--workspace", str(workspace), "--seed-only", *arguments],
        cwd=ROOT,
        env={**os.environ, "PYTHONPATH": str(ROOT)},
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
        check=False,
    )


def test_offline_seed_is_reproducible_private_and_resume_does_not_refresh_source(tmp_path):
    workspace = tmp_path / "feature-seed"
    first = run_helper(workspace)
    assert first.returncode == 0, first.stderr
    seed_path = workspace / "seed.json"
    before = seed_path.read_bytes()
    seed = json.loads(before)
    assert seed["live_collection"] == {"requested": False, "reports": []}
    assert seed["source_keys"] == [
        "ashby-blocktech",
        "ashby-cantina",
        "greenhouse-straitsx",
        "greenhouse-graviton",
    ]
    assert len(seed["source_ids"]) == 4
    assert seed["new_model_calls"] == seed["employer_emails_sent"] == 0
    assert seed["actual_recipient"] == "applications@jobpilot.test"
    assert all(
        term not in before.lower()
        for term in (b"password", b"jwt", b"access_token", b"authorization")
    )
    engine = create_engine(f"sqlite+pysqlite:///{(workspace / 'local.sqlite').as_posix()}")
    with engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM users")).scalar_one() == 1
        assert connection.execute(text("SELECT count(*) FROM crawl_runs")).scalar_one() == 0
        assert connection.execute(text("SELECT count(*) FROM email_applications")).scalar_one() == 0
        source = connection.execute(
            text("SELECT source_type,schedule,last_success_at FROM job_sources WHERE id=:id"),
            {"id": seed["sp_source_id"].replace("-", "")},
        ).one()
        assert source[0:2] == ("curated", "manual")
        observed = str(source[2])
        assert observed[:19] == seed["programme_verified_at"].replace("T", " ")[:19]
        assert (
            connection.execute(
                text("SELECT count(*) FROM job_postings WHERE status='active'")
            ).scalar_one()
            == 1
        )
        assert (
            connection.execute(
                text(
                    "SELECT count(*) FROM job_postings j JOIN job_sources s ON j.source_id=s.id WHERE s.source_type='sandbox' AND j.status='closed'"
                )
            ).scalar_one()
            == 2
        )
        assert (
            connection.execute(
                text("SELECT email FROM email_application_policies WHERE job_id=:id"),
                {"id": seed["sp_job_id"].replace("-", "")},
            ).scalar_one()
            == "internship@spgroup.com.sg"
        )
    engine.dispose()
    second = run_helper(workspace)
    assert second.returncode == 0, second.stderr
    assert seed_path.read_bytes() == before
    engine = create_engine(f"sqlite+pysqlite:///{(workspace / 'local.sqlite').as_posix()}")
    with engine.connect() as connection:
        assert (
            str(
                connection.execute(
                    text("SELECT last_success_at FROM job_sources WHERE id=:id"),
                    {"id": seed["sp_source_id"].replace("-", "")},
                ).scalar_one()
            )
            == observed
        )
    engine.dispose()
    refused = run_helper(workspace, "--collect-live")
    assert refused.returncode == 2
    assert "Resuming never adds collection" in refused.stderr
    assert seed_path.read_bytes() == before


def test_helper_refuses_existing_unowned_or_incomplete_directory(tmp_path):
    workspace = tmp_path / "unowned"
    workspace.mkdir()
    sentinel = workspace / "do-not-touch.txt"
    sentinel.write_text("Existing data", encoding="utf-8")
    before = hashlib.sha256(sentinel.read_bytes()).hexdigest()
    response = run_helper(workspace)
    assert response.returncode == 2
    assert hashlib.sha256(sentinel.read_bytes()).hexdigest() == before
    assert not (workspace / "local.sqlite").exists()
    assert not (workspace / "seed.json").exists()


@pytest.mark.parametrize(
    "arguments",
    [
        ("--api-port", "0"),
        ("--smtp-port", "18523"),
        ("--web-origin", "https://example.com"),
        ("--web-origin", "http://127.0.0.1:15523/with/path"),
        ("--extension-client-id", "*"),
        ("--extension-client-id", "a" * 31),
        ("--extension-client-id", "q" * 32),
        ("--extension-client-id", "A" * 32),
    ],
)
def test_helper_refuses_nonlocal_or_invalid_configuration_before_creating_files(
    tmp_path, arguments
):
    workspace = tmp_path / "refused"
    response = run_helper(workspace, *arguments)
    assert response.returncode == 2
    assert not workspace.exists()


def test_helper_import_is_inert_and_process_configuration_blocks_models_and_remote_sockets(
    tmp_path,
):
    response = subprocess.run(
        [
            sys.executable,
            "-c",
            """
from pathlib import Path
import sys, socket, json, os
from scripts.local_feature_workspace import configure_process
assert 'app.db.session' not in sys.modules
configure_process(Path(sys.argv[1]), 'http://127.0.0.1:15523', 1027)
assert json.loads(os.environ['EXTENSION_CLIENT_IDS']) == []
assert json.loads(os.environ['EXTENSION_WEB_ORIGINS']) == ['http://127.0.0.1:15523']
from app.llm import build_live_provider
from app.llm.contracts import ProviderCapabilityError
try:
    build_live_provider()
except ProviderCapabilityError:
    pass
else:
    raise AssertionError('live model factory must be unavailable')
from scripts.local_review_workspace import loopback_only
loopback_only()
try:
    socket.getaddrinfo('example.com', 443)
except OSError:
    pass
else:
    raise AssertionError('remote DNS must be blocked')
from app.email_applications.transport import MailConfig
config = MailConfig.from_env()
assert (config.mode, config.host, config.port, config.recipient) == ('test_smtp','127.0.0.1',1027,'applications@jobpilot.test')
print('local-only-no-live-model')
""",
            str(tmp_path),
        ],
        cwd=ROOT,
        env={**os.environ, "PYTHONPATH": str(ROOT), "LLM_API_KEY": "must-be-cleared-test-value"},
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    assert response.returncode == 0, response.stderr
    assert response.stdout.strip() == "local-only-no-live-model"
    assert not (tmp_path / "local.sqlite").exists()


def test_installed_extension_id_is_explicit_process_configuration_without_workspace_changes(tmp_path):
    response = subprocess.run(
        [sys.executable, "-c", """
from pathlib import Path
import json, os, sys
from scripts.local_feature_workspace import configure_process
configure_process(Path(sys.argv[1]), 'http://127.0.0.1:15523', 1027, extension_client_id='abcdefghijklmnopabcdefghijklmnop')
from app.core.config import Settings
settings = Settings()
assert settings.extension_client_ids == ['abcdefghijklmnopabcdefghijklmnop']
assert settings.extension_web_origins == ['http://127.0.0.1:15523']
assert settings.cors_origins == ['http://127.0.0.1:15523']
assert json.loads(os.environ['EXTENSION_CLIENT_IDS']) == settings.extension_client_ids
assert not Path(sys.argv[1]).exists()
print('explicit-extension-id-only')
""", str(tmp_path / "not-created")],
        cwd=ROOT,
        env={**os.environ, "PYTHONPATH": str(ROOT), "EXTENSION_CLIENT_IDS": '["*"]'},
        capture_output=True, text=True, timeout=15, check=False,
    )
    assert response.returncode == 0, response.stderr
    assert response.stdout.strip() == "explicit-extension-id-only"


@pytest.mark.parametrize("extension_id", [None, "abcdefghijklmnopabcdefghijklmnop"])
def test_feature_helper_cli_forwards_only_the_selected_extension_id(tmp_path, monkeypatch, extension_id):
    monkeypatch.syspath_prepend(str(ROOT / "scripts"))
    spec = importlib.util.spec_from_file_location("feature_workspace_cli_test", HELPER)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    calls = []
    monkeypatch.setattr(helper, "seed_workspace", lambda *args, **kwargs: calls.append(kwargs) or {})
    monkeypatch.setattr(helper, "loopback_only", lambda: None)
    arguments = ["--workspace", str(tmp_path / "not-created"), "--seed-only"]
    if extension_id:
        arguments += ["--extension-client-id", extension_id]
    assert helper.main(arguments) == 0
    assert calls[0]["extension_client_id"] == extension_id
    assert not (tmp_path / "not-created").exists()


def test_snapshot_cannot_replace_official_recipient(tmp_path):
    # Importing the helper does not configure the process or touch a database.
    sys.path.insert(0, str(ROOT / "scripts"))
    try:
        spec = importlib.util.spec_from_file_location("feature_workspace_snapshot_test", HELPER)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
    finally:
        sys.path.pop(0)
    snapshot = json.loads(
        (ROOT / "docs/member3/examples/sp-group-email-programme.json").read_bytes()
    )
    snapshot["email"] = "different@example.com"
    path = tmp_path / "changed-snapshot.json"
    path.write_text(json.dumps(snapshot), encoding="utf-8")
    with pytest.raises(ValueError, match="official email"):
        helper.load_programme(path)
