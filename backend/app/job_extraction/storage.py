"""Atomic output snapshots. Never write back into the scraper's input file."""

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def assert_distinct_paths(output: Path, *inputs: Path) -> None:
    resolved = output.resolve()
    for source in inputs:
        if resolved == source.resolve() or (
            output.exists() and source.exists() and os.path.samefile(output, source)
        ):
            raise ValueError("Output must not overwrite an input or fixture file")


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=".extraction-",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            json.dump(payload, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
