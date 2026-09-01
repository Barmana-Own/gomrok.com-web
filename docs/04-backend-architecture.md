# GOMROK Backend Architecture Review

## Scope decision

The task changes the experience layer. The existing Express backend already implements the required production modules and remained authoritative; no backend rewrite or contract change was justified.

## Existing module boundaries

| Responsibility | Source |
| --- | --- |
| HTTP application, registration and authentication | `server/src/app.js` |
| Marketplace and role operations | `server/src/routes/platform.routes.js` |
| Governance operations | `server/src/routes/admin.routes.js` |
| Authentication, role and idempotency middleware | `server/src/security/platform-auth.js` |
| Workflow and state rules | `server/src/domain/workflow.js` and `shared/contract.js` |
| Persistence connection and migration | `server/src/db.js`, `server/src/migrate.js`, `server/schema.sql` |
| Tenant-filtered real-time events | `server/src/realtime/broker.js` |

## Boundary verification

- Frontend changes do not alter request methods, resource paths, payload ownership, or authorization headers.
- Server-side role and permission checks remain present on marketplace and governance routes.
- Request validation, parameterized MySQL execution, safe JSON errors, correlation IDs, and bounded request bodies remain unchanged.
- Configuration rejects undersized production JWT, step-up, and administrator secrets.
- No new logger, secret, production mock, or in-memory persistence path was introduced.

## Validation

`npm test` passed all 19 backend policy, governance, isolation, workflow, and real-time broker tests. The first sandboxed run failed only because Node test workers could not spawn (`EPERM`); the same command passed outside that process restriction.

STAGE_04_STATUS: PASS
NEXT_STAGE: 05-database-architecture
