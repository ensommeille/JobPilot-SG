"""Structural tests for the first relational schema baseline."""

from sqlalchemy import inspect

from app.db.session import engine


def test_all_planned_core_tables_are_created() -> None:
    assert set(inspect(engine).get_table_names()) == {
        "application_forms",
        "applications",
        "audit_logs",
        "crawl_runs",
        "favorites",
        "form_mapping_records",
        "job_posting_tags",
        "job_postings",
        "job_sources",
        "job_tags",
        "resume_documents",
        "user_profiles",
        "users",
    }


def test_job_search_indexes_exist() -> None:
    indexes = {item["name"] for item in inspect(engine).get_indexes("job_postings")}
    assert {
        "ix_job_postings_city_type_deadline",
        "ix_job_postings_salary",
        "ix_job_postings_title",
        "ix_job_postings_company",
    } <= indexes
