"""Display formatting must retain source text and the canonical evidence input."""

from app.jobs.description import build_description_blocks


def test_html_restores_headings_paragraphs_and_lists_without_html():
    markup = "<h2>Responsibilities</h2><p>Build <strong>Python</strong> APIs.</p><ul><li>Test APIs.</li><li>Review code.</li></ul>"
    original = "Responsibilities Build Python APIs. Test APIs. Review code."
    blocks = build_description_blocks(original, markup)
    assert blocks == [
        {"kind": "heading", "text": "Responsibilities"},
        {"kind": "paragraph", "text": "Build Python APIs."},
        {"kind": "list", "items": ["Test APIs.", "Review code."], "ordered": False},
    ]
    assert original == "Responsibilities Build Python APIs. Test APIs. Review code."


def test_original_plain_bullets_can_use_matching_html_structure():
    blocks = build_description_blocks(
        "Requirements\n- Python\n- C++", "<h3>Requirements</h3><ul><li>Python</li><li>C++</li></ul>"
    )
    assert blocks[0] == {"kind": "heading", "text": "Requirements"}
    assert blocks[1]["items"] == ["Python", "C++"]


def test_mismatching_or_stale_html_falls_back_to_canonical_text():
    blocks = build_description_blocks(
        "Requirements\n\n- C++\n- No travel required",
        "<h2>Requirements</h2><p>C#</p><p>Travel required</p>",
    )
    assert blocks[1]["items"] == ["C++", "No travel required"]
    assert "C#" not in str(blocks)


def test_plain_sections_and_numbered_lists_retain_order_and_negation():
    blocks = build_description_blocks(
        "About the role\n\nBuild APIs.\n\nRequirements\n1. Python\n2. No prior employment required\n\nBenefits\n\nTraining provided."
    )
    assert [b["kind"] for b in blocks] == [
        "heading",
        "paragraph",
        "heading",
        "list",
        "heading",
        "paragraph",
    ]
    assert blocks[3] == {
        "kind": "list",
        "items": ["Python", "No prior employment required"],
        "ordered": True,
    }


def test_untrusted_markup_is_text_only_and_does_not_fetch_resources():
    blocks = build_description_blocks(
        "Build APIs.",
        '<p onclick="bad()">Build APIs.<img src="https://tracker.test/a"></p><script>steal()</script><iframe src="https://tracker.test/b"></iframe>',
    )
    assert blocks == [{"kind": "paragraph", "text": "Build APIs."}]


def test_inline_text_and_encoded_characters_survive_and_formatted_html_may_be_escaped():
    assert build_description_blocks(
        "R&D Work with Python & C++.",
        "&lt;h3&gt;R&amp;D&lt;/h3&gt;&lt;p&gt;Work with Python &amp; C++.&lt;/p&gt;",
    ) == [
        {"kind": "heading", "text": "R&D"},
        {"kind": "paragraph", "text": "Work with Python & C++."},
    ]


def test_empty_and_unstructured_text_do_not_gain_invented_headings():
    assert build_description_blocks("") == []
    assert build_description_blocks("A single original paragraph.") == [
        {"kind": "paragraph", "text": "A single original paragraph."}
    ]
