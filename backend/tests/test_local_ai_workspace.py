"""The opt-in acceptance helper never grants general outbound access or extra calls."""

import importlib.util
import json
import socket
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.llm import ProviderCapabilityError


@pytest.fixture
def local_ai(monkeypatch):
    scripts = Path(__file__).resolve().parents[2] / "scripts"
    monkeypatch.syspath_prepend(str(scripts))
    spec = importlib.util.spec_from_file_location(
        "local_ai_acceptance_test", scripts / "local_ai_workspace.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_helper_network_policy_only_allows_its_resolved_tls_endpoint(local_ai, monkeypatch):
    connected = []
    dns_queries = []

    def dns(host, port, *args, **kwargs):
        dns_queries.append((host, port))
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("203.0.113.8", 443))]

    monkeypatch.setattr(socket, "getaddrinfo", dns)
    monkeypatch.setattr(socket.socket, "connect", lambda _self, address: connected.append(address))
    monkeypatch.setattr(
        socket.socket, "connect_ex", lambda _self, address: connected.append(address) or 0
    )
    restore = local_ai.install_endpoint_network_policy()
    try:
        with pytest.raises(OSError):
            socket.getaddrinfo("employer.example.test", 443)
        with pytest.raises(OSError):
            socket.getaddrinfo("api.deepseek.com", 80)
        with pytest.raises(OSError):
            socket.getaddrinfo("api.deepseek.com.attacker.test", 443)
        with pytest.raises(OSError):
            socket.socket.connect(None, ("203.0.113.8", 443))
        assert dns_queries == []
        socket.getaddrinfo(b"api.deepseek.com", 443)
        socket.socket.connect(None, ("203.0.113.8", 443))
        assert socket.socket.connect_ex(None, ("203.0.113.8", 443)) == 0
        with pytest.raises(OSError):
            socket.socket.connect(None, ("203.0.113.8", 444))
        with pytest.raises(OSError):
            socket.socket.connect_ex(None, ("203.0.113.9", 443))
        socket.socket.connect(None, ("127.0.0.1", 1027))
        socket.socket.connect(None, ("::1", 18523, 0, 0))
        assert len(connected) == 4
    finally:
        restore()
    assert socket.getaddrinfo is dns


def test_helper_audit_has_a_hard_call_budget_and_exact_job_allowlist(local_ai, tmp_path):
    audit = local_ai.AcceptanceAudit(tmp_path, max_calls=1, allowed_ids={"chosen-job"})

    def request(job_id):
        return SimpleNamespace(
            request_id="safe-request-id",
            messages=[
                SimpleNamespace(
                    content=json.dumps(
                        {"profile": {"skills": ["Python"]}, "jobs": [{"id": job_id}]}
                    )
                )
            ],
        )

    with pytest.raises(ProviderCapabilityError):
        audit.start(request("unchosen-job"))
    assert audit.calls == 0
    assert audit.start(request("chosen-job")) == 1
    with pytest.raises(ProviderCapabilityError):
        audit.start(request("chosen-job"))
    assert audit.calls == 1
    inputs = list(tmp_path.glob("*-input.json"))
    assert len(inputs) == 1
    assert json.loads(inputs[0].read_text("utf-8"))["profile"]["skills"] == ["Python"]
    events = (tmp_path / "model-call-ledger.jsonl").read_text("utf-8").splitlines()
    assert len(events) == 1 and json.loads(events[0])["job_count"] == 1
