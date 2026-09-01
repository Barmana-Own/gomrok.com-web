# GOMROK API Integration Review

## Contract

The existing versioned contract in `openapi/gomrok-platform-v1.yaml` and the shared policy definitions in `shared/contract.js` remain unchanged. The redesign preserved all frontend request helpers and real server endpoints.

## Integration decisions

- Public authentication and registration continue to use `/api/auth/*` and `/api/registrations/*`.
- Tenant-scoped operational traffic remains under `/api/platform`.
- Governance traffic remains server-filtered and role-protected.
- Bearer authorization, correlation IDs, idempotency keys, device IDs, purpose scope, step-up tokens, and safe error mapping remain intact.
- No production fixture, hard-coded successful response, or alternate mock transport was added.
- Development preview routes use a local empty read model only because their `apiUrl` is empty and are compiled out as entry paths in production.

## Compatibility repair

`X-Purpose-Scope` is percent-encoded before being assigned to the Fetch header. This fixes a browser runtime failure when Persian purpose text contains characters outside the HTTP header byte range while preserving the semantic purpose value for decoding and audit handling.

## Validation

- Frontend production build: PASS.
- Existing contract/policy tests: PASS.
- Preview routes exercised without browser console errors: PASS.
- Live database-backed end-to-end mutations: NOT_RUN because test credentials and a running database were not available. API contracts themselves were not modified.

STAGE_06_STATUS: PASS
NEXT_STAGE: 07-authentication-authorization
