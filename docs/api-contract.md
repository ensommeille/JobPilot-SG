# API Contract (draft v0.1)

Source of truth: Development Document v0.2 §6.2. This file is the living version; update it when endpoints change.

```
# Auth
POST   /auth/register
POST   /auth/login
GET    /users/me

# Jobs
GET    /jobs?q=&tags=&city=&salary_min=&salary_max=&type=&deadline_from=&deadline_to=&page=&page_size=
GET    /jobs/{id}
POST   /jobs/{id}/favorite
DELETE /jobs/{id}/favorite
GET    /favorites
POST   /jobs/{id}/applications
GET    /applications?page=&page_size=
GET    /applications/{id}
PATCH  /applications/{id}

# Profile
GET    /profile
PUT    /profile
POST   /profile/resumes
GET    /profile/resumes

# Tags / Sources (Sources = Admin)
GET    /tags
GET    /sources
POST   /sources
POST   /sources/{id}/run
GET    /runs
GET    /runs/{id}

# Form Assistant (Phase 1 in-platform; Phase 2 extension reuses the same interface)
GET    /assistant/bootstrap
GET    /assistant/forms/{form_id}
POST   /assistant/map-fields
POST   /assistant/applications
GET    /assistant/mappings/{id}

# Admin
GET    /audit-logs
```

## Conventions

- JSON over HTTPS; JWT bearer auth; role checks on Admin endpoints.
- Registration accepts `{email, password}` and returns the public user record with HTTP 201.
- Login accepts `{email, password}` and returns `{access_token, token_type, expires_in, user}`.
- Passwords require 8–128 characters and are stored as Argon2 hashes; email uniqueness is
  case-insensitive because addresses are normalized before persistence.
- `/users/me` and all user-owned resources require `Authorization: Bearer <token>`.
- Access tokens expire after the configured interval. RBAC reads the current role from PostgreSQL,
  so a stale token cannot preserve permissions after an account or role change.
- Job list and detail routes expose only active or incomplete records. Keyword search covers title,
  company and description. Repeated or comma-separated `tags` values are intersected.
- Salary filters select overlapping job salary ranges; records without salary data are excluded only
  when a salary filter is supplied. Results use deterministic descending posted-date order.
- Job discovery and tag listing are public. Favorites require a bearer token, are isolated by user,
  and treat repeated create or delete requests idempotently.
- `PUT /profile` replaces the authenticated user's structured pre-fill data. Resume endpoints accept
  validated PDF/DOC/DOCX metadata up to 5 MiB; binary storage is outside the current MVP.
- Manual applications start as draft or submitted. Status changes follow the documented lifecycle;
  invalid or duplicate changes return HTTP 409 and another user's record appears as HTTP 404.
- `/assistant/map-fields` resolves only the authenticated user's minimized profile and delegates to
  the injectable Form Mapping Service. An unavailable service returns HTTP 503 with manual fallback.
- `/assistant/applications` accepts the form mapping, provider/prompt versions, confirmations and
  edits. Every required form field must be confirmed or edited before the application and mapping
  records are committed together.
- Ownership boundary: `/assistant/*` routers & persistence = M2; FormMappingService / DraftGenerationService (domain) = M4.
- LLM output contracts (extraction JSON, field-mapping JSON) are defined in the development document §8.2 / §9.2 and are schema-validated (Pydantic).
