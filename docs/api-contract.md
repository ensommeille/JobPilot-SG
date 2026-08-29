# API Contract (draft v0.1)

Source of truth: Development Document v0.2 §6.2. This file is the living version; update it when endpoints change.

```
# Auth
POST   /auth/register
POST   /auth/login
GET    /users/me

# Jobs
GET    /jobs?q=&tags=&city=&salary_min=&salary_max=&type=&page=
GET    /jobs/{id}
POST   /jobs/{id}/favorite
DELETE /jobs/{id}/favorite
GET    /favorites
POST   /jobs/{id}/applications

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
- Ownership boundary: `/assistant/*` routers & persistence = M2; FormMappingService / DraftGenerationService (domain) = M4.
- LLM output contracts (extraction JSON, field-mapping JSON) are defined in the development document §8.2 / §9.2 and are schema-validated (Pydantic).
