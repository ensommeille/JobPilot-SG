"""Explicit local AI recommendation acceptance; secrets stay in this process only.

Reuses the owned feature SQLite workspace. Existing extraction/form providers stay
disabled, mail stays on the loopback test sink, and only the AI recommendation
dependency can reach the fixed DeepSeek HTTPS endpoint after an explicit opt-in.
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import ipaddress
import json
import socket
import sys
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock

if __package__:
    from .local_feature_workspace import absolute_workspace, seed_workspace, web_origin
else:
    from local_feature_workspace import absolute_workspace, seed_workspace, web_origin


def install_endpoint_network_policy():
    """Allow loopback plus DNS-resolved api.deepseek.com:443; retain TLS checks."""
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex
    original_dns = socket.getaddrinfo
    provider_ips = set()
    lock = Lock()

    def local(host):
        if isinstance(host, bytes):
            host = host.decode("ascii")
        if host == "localhost":
            return True
        try:
            return ipaddress.ip_address(str(host)).is_loopback
        except ValueError:
            return False

    def check(address):
        if not isinstance(address, tuple) or len(address) < 2:
            raise OSError("Local AI workspace refuses this network address")
        host, port = address[:2]
        if local(host):
            return
        with lock:
            permitted = str(host) in provider_ips and port == 443
        if not permitted:
            raise OSError("Local AI workspace permits only its fixed model endpoint")

    def connect(sock, address):
        check(address)
        return original_connect(sock, address)

    def connect_ex(sock, address):
        check(address)
        return original_connect_ex(sock, address)

    def dns(host, port, *args, **kwargs):
        label = host.decode("ascii") if isinstance(host, bytes) else str(host)
        if local(host):
            return original_dns(host, port, *args, **kwargs)
        if label.lower().rstrip(".") != "api.deepseek.com" or str(port) != "443":
            raise OSError(
                "Local AI workspace refuses remote DNS outside its model endpoint"
            )
        values = original_dns(host, port, *args, **kwargs)
        with lock:
            provider_ips.update(str(item[4][0]) for item in values)
        return values

    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
    socket.getaddrinfo = dns

    def restore():
        socket.socket.connect = original_connect
        socket.socket.connect_ex = original_connect_ex
        socket.getaddrinfo = original_dns

    return restore


class AcceptanceAudit:
    def __init__(self, directory: Path, *, max_calls: int, allowed_ids: set[str]):
        self.directory = directory
        self.max_calls = max_calls
        self.allowed_ids = allowed_ids
        self.calls = 0
        self.lock = Lock()
        directory.mkdir(parents=True, exist_ok=True)

    def start(self, request):
        from app.llm.contracts import ProviderCapabilityError

        payload = json.loads(request.messages[-1].content)
        ids = {str(job["id"]) for job in payload["jobs"]}
        if self.allowed_ids and not ids <= self.allowed_ids:
            raise ProviderCapabilityError(
                "Local acceptance is restricted to its chosen jobs"
            )
        with self.lock:
            if self.calls >= self.max_calls:
                raise ProviderCapabilityError(
                    "Local acceptance model-call budget is exhausted"
                )
            self.calls += 1
            number = self.calls
        # Private audit input contains sanitized professional text, never the key.
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        (self.directory / f"call-{number:02d}-input.json").write_text(
            encoded, encoding="utf-8"
        )
        self.event(
            {
                "call": number,
                "event": "started",
                "request_id": request.request_id,
                "input_sha256": hashlib.sha256(encoded.encode()).hexdigest(),
                "job_count": len(ids),
            }
        )
        return number

    def event(self, data):
        with (
            self.lock,
            (self.directory / "model-call-ledger.jsonl").open(
                "a", encoding="utf-8"
            ) as stream,
        ):
            stream.write(
                json.dumps({"at": datetime.now(UTC).isoformat(), **data}) + "\n"
            )


def recommendation_runtime(key: str, audit: AcceptanceAudit, *, revision: str):
    import httpx
    from app.ai_recommendations.runtime import AIRuntime
    from app.llm.deepseek import DeepSeekProvider

    class AuditedProvider:
        name = "deepseek"
        is_mock = False

        def __init__(self, provider):
            self.provider = provider

        async def generate_structured(self, request):
            number = audit.start(request)
            try:
                response = await self.provider.generate_structured(request)
            except Exception as error:
                code = getattr(error, "code", "provider_error")
                audit.event({"call": number, "event": "failed", "error_code": code})
                raise
            # Keep model content private for independent semantic review.
            (audit.directory / f"call-{number:02d}-response.json").write_text(
                response.model_dump_json(indent=2), encoding="utf-8"
            )
            audit.event(
                {
                    "call": number,
                    "event": "returned",
                    "model": response.model,
                    "finish_reason": response.finish_reason,
                    "usage": response.usage.model_dump(),
                    "latency_ms": response.latency_ms,
                }
            )
            return response

    @asynccontextmanager
    async def factory():
        async with httpx.AsyncClient(
            timeout=60, trust_env=False, follow_redirects=False
        ) as client:
            provider = DeepSeekProvider(
                api_key=key,
                base_url="https://api.deepseek.com",
                model="deepseek-flash",
                timeout_seconds=60,
                max_retries=0,
                thinking="disabled",
                client=client,
            )
            yield AuditedProvider(provider)

    return AIRuntime(
        provider_factory=factory,
        provider="deepseek",
        model="deepseek-flash",
        is_mock=False,
        timeout_seconds=60,
        max_output_tokens=12000,
        revision=revision,
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=absolute_workspace, required=True)
    parser.add_argument("--api-port", type=int, default=18523)
    parser.add_argument(
        "--web-origin", type=web_origin, default="http://127.0.0.1:15523"
    )
    parser.add_argument("--smtp-port", type=int, default=1027)
    parser.add_argument("--allow-live-ai", action="store_true")
    parser.add_argument("--audit-directory", type=absolute_workspace, required=True)
    parser.add_argument("--allowed-jobs-file", type=Path)
    parser.add_argument("--max-live-calls", type=int, default=1, choices=range(1, 11))
    parser.add_argument(
        "--runtime-revision", default="local-ai-flash-1017-acceptance-v1"
    )
    args = parser.parse_args(argv)
    if not args.allow_live_ai:
        parser.error(
            "Explicit --allow-live-ai is required; use local_feature_workspace.py for offline mode"
        )
    if not sys.stdin.isatty():
        parser.error("Use an interactive terminal so the key is read with hidden input")
    if not 1 <= args.api_port <= 65535 or args.api_port == args.smtp_port:
        parser.error("Invalid API/SMTP ports")
    allowed = set()
    if args.allowed_jobs_file:
        allowed = {
            str(item["id"])
            for item in json.loads(args.allowed_jobs_file.read_text("utf-8"))
        }
        if not 1 <= len(allowed) <= 5:
            parser.error(
                "Acceptance job allowlist must contain between one and five IDs"
            )
    seed_workspace(
        args.workspace,
        api_port=args.api_port,
        origin=args.web_origin,
        smtp_port=args.smtp_port,
        collect_live=False,
    )
    from app.ai_recommendations.runtime import get_ai_runtime
    from app.main import app

    key = getpass.getpass("Temporary DeepSeek key (hidden; not saved): ").strip()
    if not 20 <= len(key) <= 200:
        print("A non-empty model key is required; no key was saved.", file=sys.stderr)
        return 2
    audit = AcceptanceAudit(
        args.audit_directory, max_calls=args.max_live_calls, allowed_ids=allowed
    )
    runtime = recommendation_runtime(key, audit, revision=args.runtime_revision)
    app.dependency_overrides[get_ai_runtime] = lambda: runtime
    restore = install_endpoint_network_policy()
    print(
        json.dumps(
            {
                "mode": "local-ai-recommendations-only",
                "key_saved": False,
                "max_live_calls": args.max_live_calls,
                "allowed_job_count": len(allowed),
                "other_live_providers": "disabled",
                "smtp": "loopback test inbox only",
            }
        ),
        flush=True,
    )
    try:
        import uvicorn

        uvicorn.run(app, host="127.0.0.1", port=args.api_port, reload=False, workers=1)
    finally:
        restore()
        app.dependency_overrides.pop(get_ai_runtime, None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
