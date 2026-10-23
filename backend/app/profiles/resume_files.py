"""Bounded local PDF parsing, conservative source text suggestions and private file access."""

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from threading import BoundedSemaphore
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, undefer

from app.db.models import ResumeDocument, User, UserProfile
from app.profiles.pdf_worker import label_key, section_label, skill_sublabel, split_label
from app.profiles.resume_models import ResumeFileContent
from app.profiles.schemas import ResumeRead

MAX_BYTES = 2 * 1024 * 1024
PARSER_SLOTS = BoundedSemaphore(2)
EMPTY_SUGGESTIONS = {
    "full_name": None,
    "contact_email": None,
    "phone": None,
    "education": None,
    "experience": None,
    "skills": [],
}


def parse_pdf(raw: bytes) -> dict:
    if not raw or len(raw) > MAX_BYTES:
        raise HTTPException(413, "PDF file must contain at most 2 MiB")
    if not raw.startswith(b"%PDF-"):
        raise HTTPException(422, "Upload a valid PDF file")
    if not PARSER_SLOTS.acquire(blocking=False):
        raise HTTPException(503, "PDF parser is busy; try again shortly")
    try:
        environment = {
            key: os.environ[key]
            for key in ("SYSTEMROOT", "WINDIR", "TEMP", "TMP")
            if key in os.environ
        }
        result = subprocess.run(
            [sys.executable, "-I", str(Path(__file__).with_name("pdf_worker.py"))],
            input=raw,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=environment,
            timeout=6,
            check=False,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(422, "PDF parsing exceeded the processing limit") from exc
    except OSError as exc:
        raise HTTPException(503, "Safe PDF parser is unavailable") from exc
    finally:
        PARSER_SLOTS.release()
    if result.returncode != 0 or len(result.stdout) > 400000:
        raise HTTPException(422, "PDF exceeded parser limits or could not be read")
    try:
        parsed = json.loads(result.stdout)
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(422, "PDF could not be read") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(422, "PDF parser returned an invalid result")
    if "error" in parsed:
        messages = {
            "encrypted_pdf": "Encrypted PDFs are not supported; upload an unencrypted PDF",
            "page_limit": "Resume PDF must contain between 1 and 20 pages",
            "resource_limit": "PDF exceeds parsing resource limits",
            "text_limit": "PDF contains too much text",
            "invalid_pdf": "PDF is malformed or unsupported",
            "limits_unavailable": "Safe PDF parser is unavailable",
            "size_limit": "PDF exceeds 2 MiB",
        }
        raise HTTPException(
            503 if parsed["error"] == "limits_unavailable" else 422,
            messages.get(parsed["error"], "PDF could not be read"),
        )
    if (
        parsed.get("extraction_status") not in {"parsed", "needs_text"}
        or not isinstance(parsed.get("text"), str)
        or len(parsed["text"]) > 60000
        or not isinstance(parsed.get("page_count"), int)
        or not 1 <= parsed["page_count"] <= 20
    ):
        raise HTTPException(422, "PDF parser returned an invalid result")
    return parsed


def suggestions_from_text(text: str) -> dict:
    """Copy labelled contact data and explicit sections; never infer identity or qualifications."""
    result = {**EMPTY_SUGGESTIONS, "skills": []}
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    contact_labels = {"name", "fullname", "phone", "mobile", "email", "contact", "personaldetails"}
    header_lines = []
    for line in lines:
        descriptor = section_label(line)
        if descriptor is not None and label_key(split_label(line)[0]) not in contact_labels:
            break
        header_lines.append(line)
    header = "\n".join(header_lines)
    labelled = re.search(r"(?im)^(?:full name|name|姓名)\s*[:：]\s*([^\n]{2,100})$", header)
    if labelled:
        result["full_name"] = labelled[1].strip()
    emails = list(
        dict.fromkeys(
            re.findall(
                r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}",
                header,
            )
        )
    )
    if len(emails) == 1:
        result["contact_email"] = emails[0]
    phones = list(
        dict.fromkeys(
            match[1].strip()
            for match in re.finditer(
                r"(?im)^(?:phone|mobile|telephone|tel|电话|手机)\s*[:：]\s*([+\d][\d ()-]{6,38})$",
                header,
            )
        )
    )
    if len(phones) == 1:
        result["phone"] = phones[0]
    sections = {"education": [], "experience": [], "skills": []}
    experience_blocks = []
    current_experience = None
    section = None
    for line in lines:
        sublabel, tail = skill_sublabel(line)
        if section == "skills" and sublabel:
            if tail:
                sections["skills"].append(tail)
            continue
        descriptor = section_label(line)
        if descriptor is not None:
            section, display, kind, tail = descriptor
            if section == "experience":
                current_experience = {"heading": display, "kind": kind, "lines": []}
                experience_blocks.append(current_experience)
            if section and tail:
                if section == "experience":
                    current_experience["lines"].append(tail)
                else:
                    sections[section].append(tail)
        elif section:
            if section == "experience":
                current_experience["lines"].append(line)
            else:
                sections[section].append(line)
    populated = [block for block in experience_blocks if block["lines"]]
    preserve_headings = len({block["kind"] for block in populated}) > 1
    sections["experience"] = [
        ((block["heading"] + "\n") if preserve_headings else "") + "\n".join(block["lines"])
        for block in populated
    ]
    for field, limit in (("education", 5000), ("experience", 10000)):
        value = "\n".join(sections[field])
        result[field] = value[:limit] or None
    for line in sections["skills"]:
        value = re.sub(
            r"(?i)^(?:programming languages|languages|frameworks|tools)\s*[:：]\s*", "", line
        )
        for skill in re.split(r"[,;；，•|\n]", value):
            skill = skill.strip(" -\t")
            if skill and len(skill) <= 100 and skill not in result["skills"]:
                result["skills"].append(skill)
    result["skills"] = result["skills"][:50]
    return result


def file_flags(db: Session, documents: list[ResumeDocument]) -> None:
    if not documents:
        return
    rows = db.execute(
        select(
            ResumeFileContent.resume_id,
            ResumeFileContent.sha256,
            ResumeFileContent.extraction_status,
            ResumeFileContent.page_count,
        ).where(ResumeFileContent.resume_id.in_([document.id for document in documents]))
    ).all()
    flags = {row.resume_id: row for row in rows}
    for document in documents:
        row = flags.get(document.id)
        document.has_file = row is not None
        document.sha256 = row.sha256 if row else None
        document.extraction_status = row.extraction_status if row else "metadata_only"
        document.page_count = row.page_count if row else None


def owned_resume(
    db: Session, user: User, resume_id: UUID, *, content: bool = False
) -> tuple[ResumeDocument, ResumeFileContent | None]:
    query = (
        select(ResumeDocument, ResumeFileContent)
        .join(UserProfile, UserProfile.id == ResumeDocument.profile_id)
        .outerjoin(ResumeFileContent, ResumeFileContent.resume_id == ResumeDocument.id)
        .where(ResumeDocument.id == resume_id, UserProfile.user_id == user.id)
    )
    if content:
        query = query.options(undefer(ResumeFileContent.content))
    row = db.execute(query).first()
    if row is None:
        raise HTTPException(404, "Resume not found")
    return row


def stored_attachment(db: Session, user: User, resume_id: UUID) -> tuple[str, bytes]:
    document, file = owned_resume(db, user, resume_id, content=True)
    if file is None:
        raise HTTPException(422, "This entry only contains metadata; upload an actual PDF first")
    return document.filename, bytes(file.content)


def create_file(db: Session, user: User, filename: str, raw: bytes) -> ResumeDocument:
    from app.profiles.service import get_profile

    if (
        not filename
        or len(filename) > 200
        or not filename.casefold().endswith(".pdf")
        or any(ord(c) < 32 or c in "/\\" for c in filename)
    ):
        raise HTTPException(422, "Use a PDF filename without paths or control characters")
    parsed = parse_pdf(raw)
    profile = get_profile(db, user=user)
    document = ResumeDocument(
        profile_id=profile.id,
        filename=filename,
        storage_key=f"private-resume/{user.id}/{uuid4()}.pdf",
        content_type="application/pdf",
        size_bytes=len(raw),
    )
    db.add(document)
    db.flush()
    db.add(
        ResumeFileContent(
            resume_id=document.id,
            content=raw,
            sha256=hashlib.sha256(raw).hexdigest(),
            extraction_status=parsed["extraction_status"],
            page_count=parsed["page_count"],
            text=parsed["text"],
            suggestions=suggestions_from_text(parsed["text"])
            if parsed["extraction_status"] == "parsed"
            else {**EMPTY_SUGGESTIONS, "skills": []},
        )
    )
    db.commit()
    db.refresh(document)
    file_flags(db, [document])
    return document


def resume_detail(db: Session, user: User, resume_id: UUID) -> dict:
    document, file = owned_resume(db, user, resume_id)
    file_flags(db, [document])
    return {
        **ResumeRead.model_validate(document).model_dump(mode="json"),
        "text": file.text if file else None,
        "suggestions": file.suggestions if file else {**EMPTY_SUGGESTIONS, "skills": []},
        "notice": "Review extracted text and suggestions before saving your profile. No fields have been changed automatically."
        if file and file.extraction_status == "parsed"
        else "No reliable text was extracted. Supply text manually; OCR was not performed."
        if file
        else "Metadata only; no file bytes were uploaded.",
    }
