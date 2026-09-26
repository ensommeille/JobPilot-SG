"""Run the migration chain on an isolated SQLite file, never a developer database."""

import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

from sqlalchemy import create_engine, inspect, text


def test_migration_upgrade_downgrade_preserves_legacy_job(tmp_path):
    backend = Path(__file__).resolve().parents[2]
    url = f"sqlite+pysqlite:///{(tmp_path / 'migration.sqlite').as_posix()}"
    env = {**os.environ, "DATABASE_URL": url}

    def migrate(direction, revision):
        result = subprocess.run(
            [sys.executable, "-m", "alembic", direction, revision],
            cwd=backend,
            env=env,
            capture_output=True,
            text=True,
            timeout=45,
            check=False,
        )
        assert result.returncode == 0, result.stderr

    migrate("upgrade", "20260909_0001")
    engine = create_engine(url)
    source_id, job_id = uuid4().hex, uuid4().hex
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO job_sources (id, name, source_type, base_url, enabled, status) "
                "VALUES (:id, 'Legacy', 'html', 'https://example.test', 1, 'healthy')"
            ),
            {"id": source_id},
        )
        connection.execute(
            text(
                "INSERT INTO job_postings (id, source_id, external_id, title, company, description, "
                "apply_url, dedup_hash, raw_hash, status) VALUES "
                "(:id, :source, 'legacy', 'Intern', 'Example', 'Original JD', "
                "'https://example.test/apply', :dedup, :raw, 'active')"
            ),
            {"id": job_id, "source": source_id, "dedup": "a" * 64, "raw": "b" * 64},
        )
    engine.dispose()
    migrate("upgrade", "head")
    checked = subprocess.run(
        [sys.executable, "-m", "alembic", "check"],
        cwd=backend,
        env=env,
        capture_output=True,
        text=True,
        timeout=45,
        check=False,
    )
    assert checked.returncode == 0, checked.stdout + checked.stderr
    engine = create_engine(url)
    assert "job_extraction_runs" in inspect(engine).get_table_names()
    with engine.connect() as connection:
        row = connection.execute(text("SELECT description, source_url FROM job_postings")).one()
        assert tuple(row) == ("Original JD", None)
    engine.dispose()
    migrate("downgrade", "20260909_0001")
    engine = create_engine(url)
    assert "job_extraction_runs" not in inspect(engine).get_table_names()
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT description FROM job_postings")).scalar_one()
            == "Original JD"
        )
    engine.dispose()
    migrate("upgrade", "head")


def test_postgresql_migration_compiles_without_connecting():
    backend = Path(__file__).resolve().parents[2]
    env = {**os.environ, "DATABASE_URL": "postgresql+psycopg://offline:offline@localhost/offline"}
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head", "--sql"],
        cwd=backend,
        env=env,
        capture_output=True,
        text=True,
        timeout=45,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "CREATE TABLE job_extraction_runs" in result.stdout
    assert "ADD COLUMN source_url" in result.stdout
