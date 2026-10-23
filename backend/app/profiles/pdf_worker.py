"""Standalone constrained PDF parser. Receives only bytes on stdin, never credentials.

Invoked with Python -I in a separate process. No document contents or parser errors
are logged. Output is one bounded JSON object with extracted text or a fixed code.
"""

import io
import json
import logging
import os
import re
import socket
import sys

MAX_BYTES = 2 * 1024 * 1024
MAX_TEXT = 60000
MEMORY_LIMIT = 256 * 1024 * 1024
WINDOWS_JOB = None

# Only known labels are normalized. Ordinary words, names and skill values are not joined.
SECTION_LABELS = {
    "education": ("education", "Education", None),
    "academic background": ("education", "Academic Background", None),
    "教育经历": ("education", "教育经历", None),
    "教育背景": ("education", "教育背景", None),
    "experience": ("experience", "Experience", "generic"),
    "work experience": ("experience", "Work Experience", "work"),
    "professional experience": ("experience", "Professional Experience", "work"),
    "employment history": ("experience", "Employment History", "work"),
    "projects": ("experience", "Projects", "project"),
    "project experience": ("experience", "Project Experience", "project"),
    "research experience": ("experience", "Research Experience", "research"),
    "工作经历": ("experience", "工作经历", "work"),
    "项目经历": ("experience", "项目经历", "project"),
    "科研经历": ("experience", "科研经历", "research"),
    "skills": ("skills", "Skills", None),
    "technical skills": ("skills", "Technical Skills", None),
    "技能": ("skills", "技能", None),
}
STOP_LABELS = (
    "summary",
    "professional summary",
    "profile",
    "contact",
    "certifications",
    "awards",
    "languages",
    "references",
    "interests",
    "availability",
    "availability period",
    "additional information",
    "personal details",
    "hobbies",
    "declaration",
    "disclaimer",
    "fictitious",
    "phone",
    "mobile",
    "email",
    "name",
    "full name",
)
SKILL_SUBLABELS = (
    "programming",
    "programming languages",
    "languages",
    "frameworks",
    "tools",
    "testing",
    "tools / testing",
    "ai / ml",
    "backend / data",
    "databases",
    "cloud",
    "devops",
)


def label_key(value: str) -> str:
    return re.sub(r"\s+", "", value.casefold()).rstrip(":：")


def split_label(line: str) -> tuple[str, str]:
    line = re.sub(r"^[\s•●▪◦·*-]+", "", line).strip()
    parts = re.split(r"[:：]", line, maxsplit=1)
    return parts[0].strip(), parts[1].strip() if len(parts) == 2 else ""


def section_label(line: str):
    label, tail = split_label(line)
    key = label_key(label)
    for known, descriptor in SECTION_LABELS.items():
        if key == label_key(known):
            return (*descriptor, tail)
    if key in {label_key(known) for known in STOP_LABELS}:
        return (None, label, None, tail)
    return None


def skill_sublabel(line: str) -> tuple[bool, str]:
    label, tail = split_label(line)
    return label_key(label) in {label_key(known) for known in SKILL_SUBLABELS}, tail


def extract_page_text(page) -> str:
    """Preserve layout, repairing only proven category/value rows in a Skills section.

    Visitor x coordinates are not assumed reliable: some PDFs reuse the same text
    matrix for different glyph runs. A repair needs adjacent separate runs, the
    same baseline, a known category, and exact correspondence to the entire row.
    """
    fragments = []

    def visit(text, cm, tm, _font, size):
        text = text.strip()
        if text and "\n" not in text:
            if len(fragments) >= 4096 or len(text) > MAX_TEXT:
                raise ValueError("PDF text fragment limit")
            fragments.append((text, tm[4] * cm[1] + tm[5] * cm[3] + cm[5], size))

    plain = page.extract_text(visitor_text=visit) or ""
    try:
        layout = (
            page.extract_text(extraction_mode="layout", layout_mode_space_vertically=False) or plain
        )
    except (NotImplementedError, ValueError):
        layout = plain
    rows = {}
    for index, (label, baseline, size) in enumerate(fragments[:-1]):
        value, value_baseline, _ = fragments[index + 1]
        category, _ = skill_sublabel(label)
        if (
            category
            and not skill_sublabel(value)[0]
            and abs(baseline - value_baseline) <= max(1.0, size * 0.15)
        ):
            rows[re.sub(r"\s+", "", label + value).casefold()] = label
    active_skills = False
    repaired = []
    for line in layout.splitlines():
        compact = re.sub(r"\s+", "", line).casefold()
        label = rows.get(compact) if active_skills else None
        if label is not None:
            # Split at the proven label boundary while keeping layout's value spelling.
            needed = sum(not character.isspace() for character in label)
            boundary = 0
            for index, character in enumerate(line):
                needed -= not character.isspace()
                if needed == 0:
                    boundary = index + 1
                    break
            line = line[:boundary].strip() + ": " + line[boundary:].strip()
        else:
            descriptor = section_label(line)
            if descriptor is not None and not (active_skills and skill_sublabel(line)[0]):
                active_skills = descriptor[0] == "skills"
        repaired.append(line)
    return "\n".join(repaired)


def resource_limits() -> None:
    global WINDOWS_JOB
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        class BasicLimits(ctypes.Structure):
            _fields_ = [
                ("PerProcessUserTimeLimit", ctypes.c_longlong),
                ("PerJobUserTimeLimit", ctypes.c_longlong),
                ("LimitFlags", wintypes.DWORD),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t),
                ("ActiveProcessLimit", wintypes.DWORD),
                ("Affinity", ctypes.c_size_t),
                ("PriorityClass", wintypes.DWORD),
                ("SchedulingClass", wintypes.DWORD),
            ]

        class IOCounters(ctypes.Structure):
            _fields_ = [
                (name, ctypes.c_ulonglong)
                for name in (
                    "ReadOperationCount",
                    "WriteOperationCount",
                    "OtherOperationCount",
                    "ReadTransferCount",
                    "WriteTransferCount",
                    "OtherTransferCount",
                )
            ]

        class ExtendedLimits(ctypes.Structure):
            _fields_ = [
                ("BasicLimitInformation", BasicLimits),
                ("IoInfo", IOCounters),
                ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t),
            ]

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        kernel.CreateJobObjectW.restype = wintypes.HANDLE
        kernel.SetInformationJobObject.argtypes = [
            wintypes.HANDLE,
            ctypes.c_int,
            ctypes.c_void_p,
            wintypes.DWORD,
        ]
        kernel.SetInformationJobObject.restype = wintypes.BOOL
        kernel.GetCurrentProcess.restype = wintypes.HANDLE
        kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel.AssignProcessToJobObject.restype = wintypes.BOOL
        job = kernel.CreateJobObjectW(None, None)
        limits = ExtendedLimits()
        limits.BasicLimitInformation.LimitFlags = 0x100 | 0x2000 | 0x2
        limits.BasicLimitInformation.PerProcessUserTimeLimit = 3 * 10_000_000
        limits.ProcessMemoryLimit = MEMORY_LIMIT
        if (
            not job
            or not kernel.SetInformationJobObject(
                job, 9, ctypes.byref(limits), ctypes.sizeof(limits)
            )
            or not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess())
        ):
            raise RuntimeError("limits_unavailable")
        WINDOWS_JOB = job
    else:
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (MEMORY_LIMIT, MEMORY_LIMIT))
        resource.setrlimit(resource.RLIMIT_CPU, (3, 4))
        resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))


def no_network(*_args, **_kwargs):
    raise OSError("PDF worker has no network capability")


def parse(raw: bytes) -> dict:
    from pypdf import PdfReader, filters

    # Decompression happens only inside the resource-limited worker.
    filters.ZLIB_MAX_OUTPUT_LENGTH = 4 * 1024 * 1024
    reader = PdfReader(io.BytesIO(raw), strict=True)
    if reader.is_encrypted:
        return {"error": "encrypted_pdf"}
    count = len(reader.pages)
    if not 1 <= count <= 20:
        return {"error": "page_limit"}
    chunks = []
    for page in reader.pages:
        contents = page.get_contents()
        if contents is not None and len(contents.get_data()) > 4 * 1024 * 1024:
            return {"error": "resource_limit"}
        chunks.append(extract_page_text(page))
        if sum(map(len, chunks)) > MAX_TEXT:
            return {"error": "text_limit"}
    text = "\n".join(chunks).replace("\x00", "").strip()
    return {
        "text": text,
        "page_count": count,
        "extraction_status": "parsed" if sum(c.isalnum() for c in text) >= 10 else "needs_text",
    }


def main() -> None:
    logging.disable(logging.CRITICAL)
    try:
        resource_limits()
    except Exception:
        result = {"error": "limits_unavailable"}
    else:
        socket.socket.connect = no_network
        socket.socket.connect_ex = no_network
        socket.getaddrinfo = no_network
        try:
            raw = sys.stdin.buffer.read(MAX_BYTES + 1)
            result = {"error": "size_limit"} if len(raw) > MAX_BYTES else parse(raw)
        except MemoryError:
            result = {"error": "resource_limit"}
        except Exception:
            result = {"error": "invalid_pdf"}
    sys.stdout.write(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
