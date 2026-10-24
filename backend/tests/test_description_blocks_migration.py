"""Adding display metadata must preserve existing JD evidence and identity."""

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, text


def test_display_migration_preserves_canonical_job_and_can_be_reversed(tmp_path):
    backend = Path(__file__).resolve().parents[1]
    url = f"sqlite+pysqlite:///{(tmp_path / 'description.sqlite').as_posix()}"

    def migrate(direction, revision):
        result = subprocess.run(
            [sys.executable, "-m", "alembic", direction, revision],
            cwd=backend,
            env={**os.environ, "DATABASE_URL": url},
            capture_output=True,
            text=True,
            timeout=45,
            check=False,
        )
        assert result.returncode == 0, result.stderr

    migrate("upgrade", "20261023_0008")
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO job_sources (id,name,source_type,base_url,enabled,status) VALUES ('11111111111111111111111111111111','Original source','html','https://employer.invalid',1,'healthy')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO job_postings (id,source_id,external_id,title,company,description,apply_url,dedup_hash,raw_hash,status) VALUES ('22222222222222222222222222222222','11111111111111111111111111111111','original','Original title','Original employer','Requirements: Python AND C++','https://employer.invalid/apply','dedup-original','hash-original','active')"
            )
        )
        original = tuple(
            connection.execute(
                text("SELECT id,description,raw_hash,dedup_hash,apply_url FROM job_postings")
            ).one()
        )
    engine.dispose()

    migrate("upgrade", "head")
    engine = create_engine(url)
    with engine.begin() as connection:
        assert (
            connection.execute(text("SELECT description_blocks FROM job_postings")).scalar_one()
            is None
        )
        assert (
            tuple(
                connection.execute(
                    text("SELECT id,description,raw_hash,dedup_hash,apply_url FROM job_postings")
                ).one()
            )
            == original
        )
        connection.execute(
            text(
                'UPDATE job_postings SET description_blocks=\'[{"kind":"paragraph","text":"Requirements: Python AND C++"}]\''
            )
        )
    engine.dispose()

    migrate("downgrade", "20261023_0008")
    engine = create_engine(url)
    with engine.connect() as connection:
        assert (
            tuple(
                connection.execute(
                    text("SELECT id,description,raw_hash,dedup_hash,apply_url FROM job_postings")
                ).one()
            )
            == original
        )
    engine.dispose()
