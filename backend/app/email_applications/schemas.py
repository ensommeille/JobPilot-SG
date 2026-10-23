"""Narrow candidate inputs: recipients, sender, policies and headers are server-owned."""

import base64
import binascii
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_PDF_BYTES = 2 * 1024 * 1024


class AttachmentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filename: str = Field(min_length=5, max_length=200)
    content_base64: str = Field(min_length=1, max_length=4 * ((MAX_PDF_BYTES + 2) // 3))

    @field_validator("filename")
    @classmethod
    def safe_filename(cls, value: str) -> str:
        if any(c in value for c in ("/", "\\", "\r", "\n", "\x00")) or not value.lower().endswith(
            ".pdf"
        ):
            raise ValueError("Upload a PDF filename without paths or control characters")
        return value

    @field_validator("content_base64")
    @classmethod
    def pdf_content(cls, value: str) -> str:
        try:
            raw = base64.b64decode(value, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ValueError("Attachment must contain valid base64 PDF bytes") from exc
        if len(raw) > MAX_PDF_BYTES or not raw.startswith(b"%PDF-") or b"%%EOF" not in raw[-1024:]:
            raise ValueError("Upload complete PDF bytes (maximum 2 MiB), not resume metadata")
        return value

    def content(self) -> bytes:
        return base64.b64decode(self.content_base64, validate=True)


class DraftInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    subject: str | None = Field(default=None, min_length=1, max_length=300)
    body: str | None = Field(default=None, min_length=1, max_length=20000)
    attachment: AttachmentInput | None = None
    resume_id: UUID | None = None

    @model_validator(mode="after")
    def attachment_choice(self):
        if self.attachment is not None and self.resume_id is not None:
            raise ValueError("Choose either a saved resume or a direct attachment")
        if "resume_id" in self.model_fields_set and "attachment" in self.model_fields_set:
            raise ValueError("Send only one attachment selector, not both fields")
        return self

    @field_validator("subject")
    @classmethod
    def safe_subject(cls, value: str | None) -> str | None:
        if value is not None:
            if any(c in value for c in ("\r", "\n", "\x00")) or not value.strip():
                raise ValueError("Subject cannot contain header controls or be blank")
            return value.strip()
        return value

    @field_validator("body")
    @classmethod
    def nonempty_body(cls, value: str | None) -> str | None:
        if value is not None and (not value.strip() or "\x00" in value):
            raise ValueError("Body cannot be blank or contain NUL")
        return value


class SendInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmed: Literal[True]
    review_token: str = Field(min_length=40, max_length=100)

    @field_validator("confirmed", mode="before")
    @classmethod
    def explicit_confirmation(cls, value: object) -> object:
        if value is not True:
            raise ValueError("An explicit JSON true confirmation is required")
        return value
