"""Readable, text-only JD blocks without changing canonical evidence or hashes."""

from __future__ import annotations

import html
import re

from bs4 import BeautifulSoup, NavigableString, Tag

HEADINGS = {
    "about us",
    "about the company",
    "about the role",
    "the role",
    "responsibilities",
    "key responsibilities",
    "requirements",
    "qualifications",
    "minimum qualifications",
    "preferred qualifications",
    "what you'll do",
    "what you will do",
    "what we're looking for",
    "what we are looking for",
    "what you'll need",
    "what you will need",
    "benefits",
    "what we offer",
    "what's in it for you?",
    "our culture",
    "job description",
    "job requirements",
    "your responsibilities",
    "your qualifications",
    "you will",
}
HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
BLOCK_TAGS = HEADING_TAGS | {"p", "div", "section", "article", "ul", "ol", "li", "br"}
IGNORED_TAGS = {"script", "style", "template", "iframe", "object", "svg", "canvas", "form"}
LIST_LINE = re.compile(r"^\s*(?:[-*•▪‣]\s+|\d+[.)]\s+)(.+)$")


def _text(value: str) -> str:
    return " ".join(value.split())


def _comparison(value: str) -> str:
    # Only remove presentation prefixes, preserving words, punctuation and numbers.
    value = re.sub(r"(?m)^\s*(?:[-*•▪‣]|\d+[.)])\s+", "", value)
    value = re.sub(r"(?m)^\s*#{1,6}\s+", "", value)
    return _text(value)


def _plain_blocks(description: str) -> list[dict]:
    blocks: list[dict] = []
    paragraph: list[str] = []
    bullet_items: list[str] = []
    ordered = False

    def flush_paragraph() -> None:
        if paragraph:
            blocks.append({"kind": "paragraph", "text": " ".join(paragraph)})
            paragraph.clear()

    def flush_list() -> None:
        if bullet_items:
            blocks.append({"kind": "list", "items": bullet_items.copy(), "ordered": ordered})
            bullet_items.clear()

    for raw_line in description.splitlines():
        line = _text(raw_line)
        if not line:
            flush_paragraph()
            flush_list()
            continue
        match = LIST_LINE.match(line)
        if match:
            flush_paragraph()
            line_ordered = bool(re.match(r"^\d+[.)]\s", line))
            if bullet_items and ordered != line_ordered:
                flush_list()
            ordered = line_ordered
            bullet_items.append(match.group(1))
            continue
        flush_list()
        title = re.sub(r"^#{1,6}\s+", "", line).strip()
        if (
            title.rstrip(":").casefold() in HEADINGS
            or re.match(r"^#{1,6}\s", line)
            or (len(title) < 90 and title.isupper() and any(c.isalpha() for c in title))
        ):
            flush_paragraph()
            blocks.append({"kind": "heading", "text": title})
        else:
            paragraph.append(line)
    flush_paragraph()
    flush_list()
    return blocks


def _html_blocks(soup: BeautifulSoup) -> list[dict]:
    blocks: list[dict] = []
    inline: list[str] = []

    def flush() -> None:
        text = _text(" ".join(inline))
        if text:
            blocks.append({"kind": "paragraph", "text": text})
        inline.clear()

    def walk(node) -> None:
        if isinstance(node, NavigableString):
            inline.append(str(node))
            return
        if not isinstance(node, Tag) or node.name in IGNORED_TAGS:
            return
        if node.name in HEADING_TAGS:
            flush()
            if text := _text(node.get_text(" ", strip=True)):
                blocks.append({"kind": "heading", "text": text})
        elif node.name in {"ul", "ol"}:
            flush()
            items = [
                _text(item.get_text(" ", strip=True))
                for item in node.find_all("li", recursive=False)
            ]
            if items := [item for item in items if item]:
                blocks.append({"kind": "list", "items": items, "ordered": node.name == "ol"})
        elif node.name == "p":
            flush()
            text = _text(node.get_text(" ", strip=True))
            if text:
                bold = node.find(["strong", "b"], recursive=False)
                heading = bold is not None and text == _text(bold.get_text(" ", strip=True))
                blocks.append(
                    {
                        "kind": "heading" if heading and len(text) < 150 else "paragraph",
                        "text": text,
                    }
                )
        elif node.name == "br":
            flush()
        elif node.name in BLOCK_TAGS or node.find(list(BLOCK_TAGS), recursive=True):
            flush()
            for child in node.children:
                walk(child)
            flush()
        else:
            inline.append(node.get_text(" ", strip=True))

    for child in soup.children:
        walk(child)
    flush()
    return blocks


def build_description_blocks(description: str, raw_html: str | None = None) -> list[dict]:
    """Use original markup only when its text corresponds to the canonical JD.

    Blocks contain strings, never HTML, URLs or executable attributes. Legacy
    plain text retains paragraph/list boundaries; missing structure is not guessed
    by generating or rewriting applicant requirements.
    """
    if raw_html and len(raw_html) <= 500_000:
        soup = BeautifulSoup(html.unescape(raw_html), "html.parser")
        for node in soup.find_all(list(IGNORED_TAGS)):
            node.decompose()
        if _comparison(soup.get_text(" ", strip=True)) == _comparison(description):
            blocks = _html_blocks(soup)
            # A malformed list must not quietly lose some of the visible source.
            visible = " ".join(
                block.get("text", "") or " ".join(block.get("items", [])) for block in blocks
            )
            if _comparison(visible) == _comparison(description):
                return blocks
    return _plain_blocks(description)
