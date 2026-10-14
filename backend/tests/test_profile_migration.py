"""Migration preserves pre-existing profile data on an isolated database."""

import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

from sqlalchemy import create_engine, text


def test_profile_migration_preserves_existing_details(tmp_path):
    backend = Path(__file__).resolve().parents[1]
    url = f"sqlite+pysqlite:///{(tmp_path / 'profile-migration.sqlite').as_posix()}"
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

    migrate("upgrade", "20260926_0002")
    engine = create_engine(url)
    user_id = uuid4().hex
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id,email,password_hash,role,is_active) VALUES (:id,'fixture@example.test','test-only','user',1)"
            ),
            {"id": user_id},
        )
        connection.execute(
            text(
                "INSERT INTO user_profiles (id,user_id,full_name,skills,links) VALUES (:id,:user,'Original Name','[]','{}')"
            ),
            {"id": uuid4().hex, "user": user_id},
        )
    engine.dispose()
    migrate("upgrade", "head")
    engine = create_engine(url)
    with engine.begin() as connection:
        row = connection.execute(
            text("SELECT full_name,resume_summary,nationality FROM user_profiles")
        ).one()
        assert tuple(row) == ("Original Name", None, None)
        connection.execute(text("UPDATE user_profiles SET resume_summary='Saved introduction'"))
    engine.dispose()
    migrate("upgrade", "head")
    engine = create_engine(url)
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT resume_summary FROM user_profiles")).scalar_one()
            == "Saved introduction"
        )
    engine.dispose()
    migrate("downgrade", "20260926_0002")
    engine = create_engine(url)
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT full_name FROM user_profiles")).scalar_one()
            == "Original Name"
        )
    engine.dispose()
