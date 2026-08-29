# Contributing — JobPilot SG

Course project (SWE5006). Keep it simple; these rules exist so evidence is traceable, not to slow anyone down.

## Git workflow

- GitHub Flow: `main` is always deployable; every change goes through a feature branch + Pull Request.
- Branch naming: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`, `test/<short-name>`.
- Merge: at least **1 approving review** + **CI green**. Don't self-approve your own PR.
- Keep PRs small and reviewable (< ~400 lines when possible).

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add tag-based job filtering
fix: dedupe identical postings on re-run
docs: update API contract
test: add extraction contract tests
```

## Issues & agile artifacts

- One **user story = one issue** (use the `user_story` template in `.github/ISSUE_TEMPLATE/`).
- Attach every issue to the current **Sprint milestone** and move it on the **Projects** board (To do → In progress → Review → Done).
- Burndown is derived from issue closure; keep issue states honest.
- At each sprint end: tag the release (`sprint-1`, `sprint-2`, …) and drop the sprint plan/review/retro files into `agile/`.

## Code quality gates (CI)

- `ruff check` (lint) — must pass.
- `pytest` — must pass; complex behaviour needs tests.
- Semgrep SAST + pip-audit (dependency scan) — high-severity findings must be addressed or explicitly justified.
- Docker build must succeed.

## Secrets

Never commit `.env` files, API keys, or credentials. Secrets live in GitHub Secrets / environment variables only.
