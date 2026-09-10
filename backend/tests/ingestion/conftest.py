from __future__ import annotations

from pathlib import Path

import pytest

FIXTURE_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixture_text():
    def load(name: str) -> str:
        return (FIXTURE_DIR / name).read_text(encoding="utf-8")

    return load
