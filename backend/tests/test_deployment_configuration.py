"""Check configurable local deployments without contacting the Docker engine."""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def test_isolated_compose_config_applies_build_origin_and_id_overrides(tmp_path):
    docker = shutil.which("docker")
    if not docker:
        pytest.skip("Docker CLI is not installed")
    empty_env = tmp_path / "empty.env"
    empty_env.touch()
    selected = {
        "JOBPILOT_DB_PORT": "15432",
        "JOBPILOT_REDIS_PORT": "16379",
        "JOBPILOT_API_PORT": "18200",
        "JOBPILOT_WEB_PORT": "15173",
        "VITE_API_BASE_URL": "http://127.0.0.1:18200",
        "CORS_ORIGINS": '["http://127.0.0.1:15173"]',
        "EXTENSION_WEB_ORIGINS": '["http://127.0.0.1:15173"]',
        "EXTENSION_CLIENT_IDS": '["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]',
        "JWT_SECRET_KEY": "isolated-configuration-test-not-a-real-secret",
        "JOBPILOT_DEMO_ADMIN_PASSWORD": "ConfigurationTestOnly123!",
    }
    result = subprocess.run(
        [docker, "compose", "--env-file", str(empty_env), "config", "--format", "json"],
        cwd=ROOT,
        env={**os.environ, **selected},
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    )
    services = json.loads(result.stdout)["services"]
    for service, port in [("db", 15432), ("redis", 16379), ("backend", 18200), ("frontend", 15173)]:
        mapping = services[service]["ports"][0]
        assert int(mapping["published"]) == port
        assert mapping["host_ip"] == "127.0.0.1"
    assert (
        services["frontend"]["build"]["args"]["VITE_API_BASE_URL"] == selected["VITE_API_BASE_URL"]
    )
    for key in ["CORS_ORIGINS", "EXTENSION_WEB_ORIGINS", "EXTENSION_CLIENT_IDS", "JWT_SECRET_KEY"]:
        assert services["backend"]["environment"][key] == selected[key]
    assert not services["backend"]["environment"].get("LLM_API_KEY")


def test_image_startup_and_frontend_compile_configuration():
    source = (ROOT / "frontend" / "Dockerfile").read_text(encoding="utf-8")
    assert source.index("ARG VITE_API_BASE_URL") < source.index("RUN npm run build")
    assert source.index("ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}") < source.index(
        "RUN npm run build"
    )
    backend = (ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")
    assert "&& exec uvicorn app.main:app" in backend


@pytest.mark.parametrize("component", ["frontend", "backend"])
def test_docker_context_excludes_local_environment_and_generated_files(component):
    patterns = (ROOT / component / ".dockerignore").read_text(encoding="utf-8").splitlines()
    assert ".env" in patterns and ".env.*" in patterns
    assert ".git" in patterns
    if component == "frontend":
        assert "node_modules" in patterns and "dist" in patterns
    else:
        assert ".venv" in patterns and "*.sqlite" in patterns and "output" in patterns
