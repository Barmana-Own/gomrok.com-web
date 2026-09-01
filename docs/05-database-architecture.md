# GOMROK Database Architecture Review

## Persistence baseline

The existing MySQL 8.4 schema remains unchanged. The redesign adds no entity, column, migration, seed, or data-retention requirement.

## Protected data domains

- Identity, registration, drivers, carrier organizations, memberships, and devices.
- Shipment cases, contracts, RFQ1/RFQ2 books and sealed quotes.
- Vehicles, assignments, internal bids, trips, readiness and trip events.
- Versioned documents, loading evidence, CMR/TIR, destination verification and POD.
- Relationship ledgers, settlements, claims, exceptions, notifications and audit.
- Contact reveal, governed exports, idempotency, refresh tokens, RulePacks and governance cases.

## Integrity and concurrency controls

- Tenant and business uniqueness constraints remain defined in `server/schema.sql`.
- Versioned documents, contracts, evidence, RulePacks, schedules and refresh tokens retain unique keys.
- Idempotency is persisted through `platform_idempotency_keys` with actor/tenant uniqueness.
- Foreign-data access remains mediated through authenticated membership context and parameterized queries.
- Docker initialization continues to mount the schema read-only into MySQL.

## Validation status

- Schema and migration sources inspected: PASS.
- Backend contract and governance tests: PASS, 19/19.
- Clean live MySQL migration: NOT_RUN because no local database credentials or disposable MySQL instance were provided for this frontend redesign. No schema change requires migration validation.

STAGE_05_STATUS: PASS
NEXT_STAGE: 06-api-integration
