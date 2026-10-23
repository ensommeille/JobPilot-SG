"""Real private PDF library, conservative parsing and copied email attachments."""

import base64
import hashlib
import io
import os
import subprocess
import sys
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject, NumberObject
from sqlalchemy import create_engine, event, select, text

import app.profiles.resume_files as files
from app.core.config import get_settings
from app.db.models import ResumeDocument
from app.db.session import engine
from app.email_applications.models import EmailApplication
from app.profiles.resume_models import ResumeFileContent
from tests.test_email_applications import account, pdf_bytes
from tests.test_email_applications import email_job as seed_email_job
from tests.test_extension_auth import CLIENT, connect


@pytest.fixture
def headers(client):
    return account(client, "resume-library@example.com")


@pytest.fixture
def email_job(db):
    return seed_email_job.__wrapped__(db)


def text_pdf(
    value="Name: Fictional Applicant\nEmail: fictional@example.com\nPhone: +65 8123 4567\nEducation\nFictitious University - BComp student\nProjects\nBuilt a class web application.\nSkills: Python, SQL\nAvailability\nMay to August 2027\nDeclaration\nFictitious data only.",
):
    writer = PdfWriter()
    page = writer.add_page(PdfReader(io.BytesIO(pdf_bytes())).pages[0])
    stream = DecodedStreamObject()
    lines = [
        line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        for line in value.splitlines()
    ]
    stream.set_data(
        (
            "BT /F1 12 Tf 10 90 Td 14 TL " + " ".join(f"({line}) Tj T*" for line in lines) + " ET"
        ).encode("latin1")
    )
    page[NameObject("/Contents")] = writer._add_object(stream)
    target = io.BytesIO()
    writer.write(target)
    return target.getvalue()


def image_pdf(*, encrypted=False, pages=1):
    writer = PdfWriter()
    for _ in range(pages):
        page = writer.add_blank_page(width=300, height=300)
        image = DecodedStreamObject()
        image.set_data(b"\xff\xff\xff")
        image.update(
            {
                NameObject("/Type"): NameObject("/XObject"),
                NameObject("/Subtype"): NameObject("/Image"),
                NameObject("/Width"): NumberObject(1),
                NameObject("/Height"): NumberObject(1),
                NameObject("/ColorSpace"): NameObject("/DeviceRGB"),
                NameObject("/BitsPerComponent"): NumberObject(8),
            }
        )
        page[NameObject("/Resources")] = DictionaryObject(
            {
                NameObject("/XObject"): DictionaryObject(
                    {NameObject("/Image0"): writer._add_object(image)}
                )
            }
        )
        contents = DecodedStreamObject()
        contents.set_data(b"q 200 0 0 200 0 0 cm /Image0 Do Q")
        page[NameObject("/Contents")] = writer._add_object(contents)
    if encrypted:
        writer.encrypt("not-a-real-secret")
    target = io.BytesIO()
    writer.write(target)
    return target.getvalue()


def upload(client, headers, raw=None, filename="candidate.pdf", content_type="application/pdf"):
    return client.post(
        "/profile/resumes/upload",
        headers=headers,
        files={"file": (filename, text_pdf() if raw is None else raw, content_type)},
    )


def test_upload_extract_download_and_profile_stays_unchanged(client, headers, db):
    raw = text_pdf()
    response = upload(client, headers, raw)
    assert response.status_code == 201, response.text
    assert response.headers["cache-control"] == "no-store"
    item = response.json()
    assert item["has_file"] and item["extraction_status"] == "parsed" and item["page_count"] == 1
    assert item["sha256"] == hashlib.sha256(raw).hexdigest()
    assert "text" not in item and "content" not in item and "storage_key" not in item
    detail = client.get(f"/profile/resumes/{item['id']}", headers=headers)
    assert detail.headers["cache-control"] == "no-store"
    suggestions = detail.json()["suggestions"]
    assert suggestions == {
        "full_name": "Fictional Applicant",
        "contact_email": "fictional@example.com",
        "phone": "+65 8123 4567",
        "education": "Fictitious University - BComp student",
        "experience": "Built a class web application.",
        "skills": ["Python", "SQL"],
    }
    assert "May to August 2027" in detail.json()["text"]
    profile = client.get("/profile", headers=headers).json()
    assert profile["full_name"] is None and profile["education"] is None and profile["skills"] == []
    assert profile["resumes"] == [item]
    listed = client.get("/profile/resumes", headers=headers)
    assert listed.json() == [item]
    assert "suggestions" not in listed.text and "Built a class" not in listed.text
    content = client.get(f"/profile/resumes/{item['id']}/content", headers=headers)
    assert content.content == raw
    assert content.headers["cache-control"] == "no-store"
    assert content.headers["x-content-type-options"] == "nosniff"
    assert content.headers["content-disposition"].startswith("attachment;")
    assert db.get(ResumeFileContent, UUID(item["id"])).content == raw


def test_old_json_metadata_remains_compatible_and_cannot_be_used_as_file(
    client, headers, email_job
):
    old = client.post(
        "/profile/resumes",
        headers=headers,
        json={
            "filename": "old.docx",
            "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "size_bytes": 100,
        },
    ).json()
    assert old["has_file"] is False and old["sha256"] is None
    assert old["extraction_status"] == "metadata_only" and old["page_count"] is None
    assert client.get("/profile/resumes", headers=headers).json() == [old]
    assert client.get(f"/profile/resumes/{old['id']}", headers=headers).json()["text"] is None
    assert client.get(f"/profile/resumes/{old['id']}/content", headers=headers).status_code == 422
    assert (
        client.post(
            f"/jobs/{email_job.id}/email-applications",
            headers=headers,
            json={"resume_id": old["id"]},
        ).status_code
        == 422
    )


def test_scanned_pdf_is_saved_downloadable_and_needs_manual_text(client, headers):
    raw = image_pdf()
    response = upload(client, headers, raw)
    assert response.status_code == 201, response.text
    item = response.json()
    assert item["has_file"] and item["extraction_status"] == "needs_text"
    detail = client.get(f"/profile/resumes/{item['id']}", headers=headers).json()
    assert detail["text"] == "" and detail["suggestions"]["skills"] == []
    assert (
        detail["suggestions"]["full_name"] is None and "OCR was not performed" in detail["notice"]
    )
    assert client.get(f"/profile/resumes/{item['id']}/content", headers=headers).content == raw


@pytest.mark.parametrize(
    "raw,filename,mime,code",
    [
        (b"%PDF-1.4\nnot a PDF\n%%EOF", "bad.pdf", "application/pdf", 422),
        (b"<html>not pdf</html>", "bad.pdf", "application/pdf", 422),
        (b"x" * (files.MAX_BYTES + 1), "huge.pdf", "application/pdf", 413),
        (b"x", "../resume.pdf", "application/pdf", 422),
        (b"x", "cv.exe", "application/pdf", 422),
        (b"x", "cv.pdf", "text/html", 422),
    ],
    ids=["malformed", "html", "oversize", "path", "extension", "mime"],
)
def test_invalid_uploads_are_rejected_without_storing_files(
    client, headers, db, raw, filename, mime, code
):
    response = upload(client, headers, raw, filename, mime)
    assert response.status_code == code
    assert response.headers["cache-control"] == "no-store"
    assert db.scalar(select(ResumeDocument)) is None
    assert db.scalar(select(ResumeFileContent)) is None


@pytest.mark.parametrize("kind", ["encrypted", "too_many_pages"])
def test_encrypted_and_excessive_page_pdfs_are_rejected(client, headers, kind):
    response = upload(
        client,
        headers,
        image_pdf(encrypted=kind == "encrypted", pages=21 if kind == "too_many_pages" else 1),
    )
    assert response.status_code == 422, response.text
    assert "Encrypted" in response.text if kind == "encrypted" else "20 pages" in response.text


def test_cross_account_and_extension_file_access_is_denied(client, headers, monkeypatch):
    item = upload(client, headers).json()
    other = account(client, "other-resume@example.com")
    assert client.get("/profile/resumes", headers=other).json() == []
    for suffix in ("", "/content"):
        assert (
            client.get(f"/profile/resumes/{item['id']}{suffix}", headers=other).status_code == 404
        )
        assert client.get(f"/profile/resumes/{item['id']}{suffix}").status_code == 401
    assert client.delete(f"/profile/resumes/{item['id']}", headers=other).status_code == 404
    assert upload(client, {}).status_code == 401
    monkeypatch.setattr(get_settings(), "extension_client_ids", [CLIENT])
    restricted, _ = connect(client, headers)
    assert upload(client, restricted).status_code == 401
    for suffix in ("", "/content"):
        assert (
            client.get(f"/profile/resumes/{item['id']}{suffix}", headers=restricted).status_code
            == 401
        )
    assert client.delete(f"/profile/resumes/{item['id']}", headers=restricted).status_code == 401


def test_email_copies_private_resume_and_survives_library_deletion(client, headers, email_job, db):
    raw = text_pdf()
    resume = upload(client, headers, raw).json()
    created = client.post(
        f"/jobs/{email_job.id}/email-applications",
        headers=headers,
        json={
            "subject": "Programme application",
            "body": "Please find my selected CV attached",
            "resume_id": resume["id"],
        },
    )
    assert created.status_code == 201, created.text
    draft = created.json()
    assert draft["attachment"]["sha256"] == resume["sha256"]
    assert draft["attachment"]["filename"] == resume["filename"]
    other = account(client, "resume-attacker@example.com")
    assert (
        client.post(
            f"/jobs/{email_job.id}/email-applications",
            headers=other,
            json={"resume_id": resume["id"]},
        ).status_code
        == 404
    )
    deleted = client.delete(f"/profile/resumes/{resume['id']}", headers=headers)
    assert deleted.status_code == 204 and deleted.headers["cache-control"] == "no-store"
    assert client.get(f"/profile/resumes/{resume['id']}", headers=headers).status_code == 404
    assert client.get("/profile/resumes", headers=headers).json() == []
    assert db.get(ResumeFileContent, UUID(resume["id"])) is None
    email = db.get(EmailApplication, UUID(draft["id"]))
    assert email.attachment_content == raw
    assert (
        client.post(f"/email-applications/{draft['id']}/preview", headers=headers).status_code
        == 200
    )


def test_reselecting_resume_invalidates_preview_and_null_removes_snapshot(
    client, headers, email_job, monkeypatch
):
    monkeypatch.setenv("JOBPILOT_EMAIL_MODE", "test_smtp")
    first = upload(client, headers).json()
    second = upload(
        client, headers, text_pdf("Name: Different Fictional Applicant\nSkills: Java")
    ).json()
    draft = client.post(
        f"/jobs/{email_job.id}/email-applications", headers=headers, json={"resume_id": first["id"]}
    ).json()
    reviewed = client.post(f"/email-applications/{draft['id']}/preview", headers=headers).json()
    path = f"/email-applications/{draft['id']}"
    changed = client.put(
        path,
        headers=headers,
        json={"subject": draft["subject"], "body": draft["body"], "resume_id": second["id"]},
    )
    assert changed.status_code == 200
    assert changed.json()["attachment"]["sha256"] == second["sha256"]
    assert (
        client.post(
            path + "/send",
            headers=headers,
            json={"confirmed": True, "review_token": reviewed["review_token"]},
        ).status_code
        == 409
    )
    cleared = client.put(
        path,
        headers=headers,
        json={"subject": draft["subject"], "body": draft["body"], "resume_id": None},
    )
    assert cleared.json()["attachment"] is None


def test_resume_and_direct_attachment_are_mutually_exclusive(client, headers, email_job):
    resume = upload(client, headers).json()
    response = client.post(
        f"/jobs/{email_job.id}/email-applications",
        headers=headers,
        json={
            "resume_id": resume["id"],
            "attachment": {
                "filename": "cv.pdf",
                "content_base64": base64.b64encode(text_pdf()).decode(),
            },
        },
    )
    assert response.status_code == 422


def test_unknown_length_streaming_multipart_is_limited_before_handler(client, headers, monkeypatch):
    monkeypatch.setattr(
        files, "parse_pdf", lambda *_: pytest.fail("Oversized request reached PDF parser")
    )

    def chunks():
        yield b'--bounded\r\nContent-Disposition: form-data; name="file"; filename="cv.pdf"\r\nContent-Type: application/pdf\r\n\r\n'
        for _ in range(34):
            yield b"x" * 65536
        yield b"\r\n--bounded--\r\n"

    response = client.post(
        "/profile/resumes/upload",
        headers={**headers, "Content-Type": "multipart/form-data; boundary=bounded"},
        content=chunks(),
    )
    assert response.status_code == 413
    assert response.headers["cache-control"] == "no-store"


def test_list_does_not_select_blob_or_text_and_query_count_is_bounded(client, headers):
    for _ in range(3):
        assert upload(client, headers).status_code == 201
    statements = []

    def observe(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", observe)
    try:
        assert len(client.get("/profile/resumes", headers=headers).json()) == 3
    finally:
        event.remove(engine, "before_cursor_execute", observe)
    assert len(statements) <= 5
    assert not any(
        "resume_file_contents.content" in statement or "resume_file_contents.text" in statement
        for statement in statements
    )


def test_suggestions_keep_explicit_sections_and_omit_availability_and_reference_contacts():
    parsed = files.suggestions_from_text(
        "Name: Fictional Candidate\ncandidate@example.com\nEducation: BComp student\nExperience: Built a class app\nSkills: Python, SQL\nAvailability period\nMay to August 2027\nDeclaration\nFictitious testing only\nReferences\nName: Other Person\nreference@example.com"
    )
    assert (
        parsed["full_name"] == "Fictional Candidate"
        and parsed["contact_email"] == "candidate@example.com"
    )
    assert parsed["education"] == "BComp student" and parsed["experience"] == "Built a class app"
    assert parsed["skills"] == ["Python", "SQL"]
    assert (
        files.suggestions_from_text("Software Engineer\nSingapore\nPython developer")
        == files.EMPTY_SUGGESTIONS
    )


def test_parser_timeout_and_worker_environment_are_bounded_without_pii_logging(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "must-not-reach-parser")

    def timeout(command, **kwargs):
        assert command[1] == "-I" and command[-1].endswith("pdf_worker.py")
        assert kwargs["timeout"] == 6 and kwargs["stderr"] == subprocess.DEVNULL
        assert "LLM_API_KEY" not in kwargs["env"] and "JWT_SECRET_KEY" not in kwargs["env"]
        raise subprocess.TimeoutExpired(command, 6)

    monkeypatch.setattr(files.subprocess, "run", timeout)
    with pytest.raises(HTTPException) as error:
        files.parse_pdf(text_pdf())
    assert error.value.status_code == 422 and "processing limit" in error.value.detail


def test_suggestions_do_not_read_project_email_or_summary_as_contact_or_skills():
    result = files.suggestions_from_text(
        "Project Experience\nBuilt an app\nproject-contact@example.com\nSkills: Python\nProfessional Summary\nSeeking an internship"
    )
    assert result["contact_email"] is None
    assert result["skills"] == ["Python"]
    assert result["experience"] == "Built an app\nproject-contact@example.com"
    result = files.suggestions_from_text("Education:BComp student\nproject-contact@example.com")
    assert (
        result["contact_email"] is None
        and result["education"] == "BComp student\nproject-contact@example.com"
    )


def test_normalized_headings_and_skills_sublabels_preserve_experience_types():
    result = files.suggestions_from_text(
        "• EDUCA TION\nFictitious Institute degree student\nTECHNICAL SKILLS\nLanguages: Go, Rust\nFrameworks: Svelte\nAI / ML: Clustering, Regression\nPROJECT EXPERIENCE\nBuilt a class tool.\nRESEARCH EXPERIENCE\nInvestigated a synthetic dataset.\nADDITIONAL INFORMA TION\nAvailable next term\nLanguages\nEnglish"
    )
    assert result["education"] == "Fictitious Institute degree student"
    assert result["skills"] == ["Go", "Rust", "Svelte", "Clustering", "Regression"]
    assert (
        result["experience"]
        == "Project Experience\nBuilt a class tool.\nResearch Experience\nInvestigated a synthetic dataset."
    )
    assert "Available" not in result["experience"] and "English" not in result["skills"]
    assert result["full_name"] is None and result["phone"] is None
    assert (
        files.suggestions_from_text("Experience\nBuilt a toy service.")["experience"]
        == "Built a toy service."
    )


def styled_skills_pdf():
    """Synthetic font runs reproduce category/value glue without using a personal PDF."""
    writer = PdfWriter()
    page = writer.add_blank_page(width=600, height=800)
    regular = writer._add_object(
        DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            }
        )
    )
    bold = writer._add_object(
        DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica-Bold"),
            }
        )
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {
            NameObject("/Font"): DictionaryObject(
                {NameObject("/F1"): regular, NameObject("/F2"): bold}
            )
        }
    )
    operators = ["BT /F2 11 Tf 30 760 Td (TECHNICAL SKILLS) Tj ET"]
    for y, label, value in (
        (730, "Programming", "Go, Rust"),
        (710, "AI / ML", "Clustering, Regression"),
        (690, "Backend / Data", "Redis, HTTP"),
        (670, "Tools / Testing", "Mercurial, Component Testing"),
    ):
        operators.append(f"BT /F2 11 Tf 30 {y} Td ({label}) Tj /F1 11 Tf ({value}) Tj ET")
    operators.extend(
        [
            "BT /F2 11 Tf 30 630 Td (PROJECT EXPERIENCE) Tj ET",
            "BT /F1 11 Tf 30 610 Td (Built a class tool.) Tj ET",
            "BT /F2 11 Tf 30 570 Td (RESEARCH EXPERIENCE) Tj ET",
            "BT /F1 11 Tf 30 550 Td (Studied a synthetic dataset.) Tj ET",
            "BT /F2 11 Tf 30 510 Td (ADDITIONAL INFORMATION) Tj ET",
            "BT /F1 11 Tf 30 490 Td (Fictitious declaration) Tj ET",
        ]
    )
    stream = DecodedStreamObject()
    stream.set_data("\n".join(operators).encode("ascii"))
    page[NameObject("/Contents")] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def test_real_parser_repairs_only_proven_styled_skill_rows():
    raw = styled_skills_pdf()
    original_plain = PdfReader(io.BytesIO(raw)).pages[0].extract_text()
    assert "ProgrammingGo" in original_plain
    parsed = files.parse_pdf(raw)
    assert "Programming: Go" in parsed["text"]
    suggestions = files.suggestions_from_text(parsed["text"])
    assert suggestions["skills"] == [
        "Go",
        "Rust",
        "Clustering",
        "Regression",
        "Redis",
        "HTTP",
        "Mercurial",
        "Component Testing",
    ]
    assert "Project Experience\n" in suggestions["experience"]
    assert "Research Experience\n" in suggestions["experience"]
    assert "Fictitious declaration" not in suggestions["experience"]


def test_unknown_glued_words_are_not_split_and_other_sections_are_not_repaired():
    result = files.suggestions_from_text(
        "Skills\nProgrammingLanguageX, ResearchToolY\nAdditional Information\nOther text"
    )
    assert result["skills"] == ["ProgrammingLanguageX", "ResearchToolY"]


def test_compressed_content_expansion_is_rejected_inside_bounded_worker(client, headers):
    writer = PdfWriter()
    page = writer.add_page(PdfReader(io.BytesIO(text_pdf())).pages[0])
    stream = DecodedStreamObject()
    stream.set_data(b" " * (5 * 1024 * 1024))
    page[NameObject("/Contents")] = writer._add_object(stream.flate_encode())
    output = io.BytesIO()
    writer.write(output)
    assert len(output.getvalue()) < files.MAX_BYTES
    response = upload(client, headers, output.getvalue())
    assert response.status_code == 422


def test_resume_file_migration_preserves_metadata_and_round_trips(tmp_path):
    backend = Path(__file__).resolve().parents[1]
    url = f"sqlite+pysqlite:///{(tmp_path / 'resume-migration.sqlite').as_posix()}"

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

    migrate("upgrade", "20261023_0006")
    database = create_engine(url)
    user, profile, resume = [uuid4().hex for _ in range(3)]
    with database.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id,email,password_hash,role,is_active) VALUES (:id,'migration@example.test','test-only','job_seeker',1)"
            ),
            {"id": user},
        )
        connection.execute(
            text(
                "INSERT INTO user_profiles (id,user_id,full_name,skills,links) VALUES (:id,:user,'Original Name','[]','{}')"
            ),
            {"id": profile, "user": user},
        )
        connection.execute(
            text(
                "INSERT INTO resume_documents (id,profile_id,filename,storage_key,content_type,size_bytes) VALUES (:id,:profile,'old.pdf','old/metadata','application/pdf',100)"
            ),
            {"id": resume, "profile": profile},
        )
    database.dispose()
    migrate("upgrade", "20261023_0007")
    database = create_engine(url)
    with database.begin() as connection:
        assert (
            connection.execute(text("SELECT filename FROM resume_documents")).scalar_one()
            == "old.pdf"
        )
        assert (
            connection.execute(text("SELECT count(*) FROM resume_file_contents")).scalar_one() == 0
        )
    database.dispose()
    migrate("downgrade", "20261023_0006")
    database = create_engine(url)
    with database.connect() as connection:
        assert (
            connection.execute(text("SELECT filename FROM resume_documents")).scalar_one()
            == "old.pdf"
        )
    database.dispose()
