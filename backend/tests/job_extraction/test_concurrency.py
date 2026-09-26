"""Independent-session lease tests; all model work is an in-memory test double."""

import asyncio
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db.base import Base
from app.db.models import JobExtractionRun, JobPosting, JobSource, User, UserRole
from app.job_extraction.persistence import ExtractionRequestError, execute, recover_expired
from app.job_extraction.runtime import ExtractionRuntime, mock_provider


@pytest.mark.parametrize("recover", [False, True])
def test_inflight_requests_are_excluded_and_late_results_cannot_overwrite(tmp_path, recover):
    engine = create_engine(f"sqlite+pysqlite:///{(tmp_path / 'concurrency.sqlite').as_posix()}")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as seed:
            user = User(email="lease@example.com", password_hash="unused", role=UserRole.ADMIN)
            source = JobSource(
                name="Lease", source_type="mock", base_url="https://jobs.example.test"
            )
            seed.add_all([user, source])
            seed.flush()
            job = JobPosting(
                source_id=source.id,
                external_id="one",
                title="Intern",
                company="Example",
                description="Test APIs",
                apply_url="https://jobs.example.test/apply",
                source_url="https://jobs.example.test/job/one",
                raw_hash="a" * 64,
                dedup_hash="b" * 64,
            )
            seed.add(job)
            seed.commit()
            job_id, actor_id = job.id, user.id

        async def scenario():
            entered, release = asyncio.Event(), asyncio.Event()
            calls = []

            class WaitingProvider:
                name = "mock"
                is_mock = True

                async def generate_structured(self, request):
                    calls.append(request)
                    entered.set()
                    await release.wait()
                    async with mock_provider() as provider:
                        return await provider.generate_structured(request)

            @asynccontextmanager
            async def factory():
                yield WaitingProvider()

            runtime = replace(ExtractionRuntime(), provider_factory=factory)
            with Session(engine) as first, Session(engine) as second:
                task = asyncio.create_task(
                    execute(first, job_id=job_id, actor_id=actor_id, runtime=runtime)
                )
                await asyncio.wait_for(entered.wait(), timeout=5)
                try:
                    with pytest.raises(ExtractionRequestError) as conflict:
                        await execute(
                            second, job_id=job_id, actor_id=actor_id, runtime=runtime, force=True
                        )
                    assert conflict.value.code == "extraction_already_running"
                    if recover:
                        record = second.scalar(select(JobExtractionRun))
                        record.expires_at = datetime.now(UTC) - timedelta(seconds=1)
                        second.commit()
                        recover_expired(second, record.id, actor_id)
                finally:
                    release.set()
                if recover:
                    with pytest.raises(ExtractionRequestError) as late:
                        await task
                    assert late.value.code == "extraction_no_longer_running"
                    second.expire_all()
                    record = second.scalar(select(JobExtractionRun))
                    assert record.error_code == "extraction_interrupted"
                    assert record.result_json is None
                else:
                    completed, _ = await task
                    reused, cached = await execute(
                        second, job_id=job_id, actor_id=actor_id, runtime=runtime
                    )
                    assert cached is True
                    assert reused.id == completed.id
                assert len(calls) == 1

        asyncio.run(scenario())
    finally:
        engine.dispose()
