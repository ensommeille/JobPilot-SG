"""Acceptance scripts cannot send test credentials to non-loopback URLs."""

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "verify_deployment_api.py"
SPEC = importlib.util.spec_from_file_location("verify_deployment_api", SCRIPT)
verification = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verification)


@pytest.mark.parametrize("url", ["http://127.0.0.1:18200", "http://localhost:8000"])
def test_acceptance_allows_explicit_loopback_origins(url):
    assert verification.local_origin(url) == url


@pytest.mark.parametrize(
    "url",
    [
        "https://api.example.com",
        "http://127.0.0.1:18200/path",
        "http://127.0.0.1:18200?key=x",
        "http://127.0.0.1:18200#fragment",
        "http://name:password@127.0.0.1:18200",
        "http://127.0.0.1",
        "http://localhost.evil.test:18200",
        "http://127.0.0.1:99999",
        " http://127.0.0.1:18200",
        "http://127.0.0.1:18200\n",
        "http://localhost:0/",
        "http://localhost:0",
    ],
)
def test_acceptance_rejects_decorated_or_nonlocal_urls(url):
    with pytest.raises(ValueError):
        verification.local_origin(url)


def test_acceptance_never_follows_redirects_with_credentials():
    assert (
        verification.NoRedirect().redirect_request(
            None, None, 302, "redirect", {}, "https://untrusted.example/collect"
        )
        is None
    )
