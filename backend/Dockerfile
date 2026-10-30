FROM python:3.13-slim

# Pull in Debian security fixes for the base image before installing app deps.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml ./
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

# pip is only needed during the build. Its vendored msgpack is not an app dependency.
RUN pip install --no-cache-dir --upgrade pip setuptools && \
    pip install --no-cache-dir . && \
    python -m pip uninstall -y pip

# Run as a non-root user.
RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).status == 200 else 1)"

# Migrate, seed idempotent demo data, then serve.
CMD ["sh", "-c", "alembic upgrade head && python -m app.demo_seed && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
