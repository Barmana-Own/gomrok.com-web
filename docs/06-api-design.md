# GOMROK API Integration Review

## Contract

The existing versioned contract in `openapi/gomrok-platform-v1.yaml` and the shared policy definitions in `shared/contract.js` remain the source of truth. The role-panel entry work adds a real organization login contract without replacing existing driver, carrier, or admin endpoints.

## Integration decisions

- Public authentication and registration continue to use `/api/auth/*` and `/api/registrations/*`.
- Shipper, Company X/forwarder, and Agent/Z panel gateways authenticate through `POST /api/auth/login-platform`; the server resolves only active IAM-provisioned credentials and memberships allowed for the requested panel.
- Governance users with the required step-up evidence can provision or rotate an organization credential through `PUT /api/platform/admin/users/{userId}/credentials`; no password is returned by the API.
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
- Live database-backed end-to-end mutations: NOT_RUN because test credentials and a running database were not available. The organization credential table is included in `server/schema.sql`; no database migration was executed in this worktree.

STAGE_06_STATUS: PASS
NEXT_STAGE: 07-authentication-authorization
