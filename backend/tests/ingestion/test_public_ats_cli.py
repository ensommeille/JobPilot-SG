"""Source discovery and import previews must not start background or paid work."""

from __future__ import annotations

import argparse

import pytest

from app.ingestion import public_ats_cli
from app.ingestion.models import SourceType
from app.ingestion.public_ats_adapter import public_ats_identity
from app.ingestion.source_catalog import DEFAULT_SOURCE_CATALOG, catalog_source


@pytest.fixture(autouse=True)
def reject_database_session(monkeypatch):
    def forbidden():
        raise AssertionError("A preview must not open the database")

    monkeypatch.setattr(public_ats_cli, "SessionLocal", forbidden)


def test_list_catalog_and_selected_preview_do_not_access_network_or_database(capsys):
    assert public_ats_cli.main(["--list-catalog"]) == 0
    listing = capsys.readouterr().out
    assert "ashby-blocktech" in listing and "default interval=6h" in listing
    assert "internsg" in listing and "default interval=24h" in listing
    assert public_ats_cli.main(["--catalog-source", "ashby-blocktech"]) == 0
    preview = capsys.readouterr().out
    assert "BlockTech" in preview and "up to 20 Singapore early-career jobs" in preview
    assert "Cantina" not in preview
    assert "does not enable scheduling or call a model" in preview


def test_catalog_selection_is_explicit_and_bounds_apply_to_reviewed_board(capsys):
    with pytest.raises(SystemExit) as error:
        public_ats_cli.main([])
    assert error.value.code == 2
    assert (
        public_ats_cli.main(
            [
                "--catalog-source",
                "ashby-cantina",
                "--max-jobs",
                "100",
            ]
        )
        == 0
    )
    assert "up to 20 Singapore early-career jobs" in capsys.readouterr().out


def test_catalog_separates_providers_from_employers_and_sets_only_default_intervals():
    assert len({entry.key for entry in DEFAULT_SOURCE_CATALOG}) == len(DEFAULT_SOURCE_CATALOG)
    providers = set()
    for entry in DEFAULT_SOURCE_CATALOG:
        if entry.source_type is SourceType.JSON:
            assert entry.interval_hours == 6
            providers.add(public_ats_identity(entry.base_url)[0])
        else:
            assert entry.key == "internsg" and entry.interval_hours == 24
    assert providers == {"ashby", "greenhouse", "lever"}
    with pytest.raises(ValueError, match="Unknown catalog source"):
        catalog_source("unreviewed-company")


def test_source_argument_accepts_public_ashby_feed_but_not_credentialed_api():
    assert (
        public_ats_cli._source_argument(
            "BlockTech=https://api.ashbyhq.com/posting-api/job-board/blocktech"
        )[0]
        == "BlockTech"
    )
    with pytest.raises(argparse.ArgumentTypeError):
        public_ats_cli._source_argument("Private=https://api.ashbyhq.com/jobPosting.list")
