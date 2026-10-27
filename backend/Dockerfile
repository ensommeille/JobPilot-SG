FROM python:3.13-slim

# Pull in Debian security fixes for the base image before installing app deps.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml ./
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

RUN pip install --no-cache-dir --upgrade pip setuptools && pip install --no-cache-dir .

EXPOSE 8000

# Migrate, seed idempotent demo data, then serve.
CMD ["sh", "-c", "alembic upgrade head && python -m app.demo_seed && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
