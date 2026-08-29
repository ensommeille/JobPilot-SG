"""CI skeleton validator: fail if the baseline repo structure is incomplete."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

REQUIRED = [
    "README.md",
    "CONTRIBUTING.md",
    ".gitignore",
    "docker-compose.yml",
    "docs/README.md",
    "docs/api-contract.md",
    "agile/README.md",
    "agile/product-backlog.md",
    "backend/pyproject.toml",
    "backend/app/main.py",
    "backend/tests/test_health.py",
    "frontend/README.md",
    "extension/README.md",
    "scripts/check_skeleton.py",
    ".github/workflows/ci.yml",
]

missing = [p for p in REQUIRED if not (ROOT / p).exists()]
if missing:
    print("MISSING paths:")
    for p in missing:
        print("  -", p)
    raise SystemExit(1)

print(f"Skeleton OK: {len(REQUIRED)} required paths present")
