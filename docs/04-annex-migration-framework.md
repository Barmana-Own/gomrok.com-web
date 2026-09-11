# Structural Annex Migration Preparation Contract

## Scope

This document defines the non-executing PREPARE boundary for the structural-annex migrations. It does not authorize a database connection or apply a migration. M1, M2, and M3 have checksum-pinned preflight, apply, and postcheck artifacts; they remain `PREPARED`, never `READY`, until a separately authorized disposable-MySQL run provides evidence.

The existing `server/src/migrate.js` entry point remains unchanged for backward compatibility. The annex CLI imports no database pool and exposes only dry-run planning. Production data, production schema, and the legacy migration path are untouched.

## Deterministic M1–M8 sequence

| Slot | Owning package | Canonical scope | Current state |
|---|---|---|---|
| M1 | P10 | Create `OperatingContext`; stage initial FWD/CAR contexts from existing unambiguous role evidence | PREPARED |
| M2 | P10 | Create `OrganizationRoleGrant`; preserve legacy role observations as E0/pending, link contexts, and add membership/session binding | PREPARED |
| M3 | P11 | Add nullable context columns to transactional data and perform controlled, resumable backfill | PREPARED |
| M4 | P11 | Require resolved context and enforce fail-closed repository/query boundaries | RESERVED |
| M5 | P12 | Add `DocumentIssuerAuthority` and migrate only attributable issuer authority | RESERVED |
| M6 | P20 | Add Consignment, AllocationLot, and VehicleAssignment hierarchy without recreating legacy trips | RESERVED |
| M7 | P21 | Add cross-tenant active-vehicle reservation after historical conflict resolution | RESERVED |
| M8 | P40 | Add context ledgers and reconciled inter-context balances without creating synthetic receivables | RESERVED |

The order is fixed. Each slot depends on the immediately preceding slot. A reserved slot cannot reference artifacts. Reordering, omission, duplication, dependency drift, unsafe paths, malformed digests, or checksum drift fails planning.

Manifest schema version `2` adds mandatory postcheck descriptors to every artifact-bearing slot. It is separate from both the OpenAPI syntax version and the business contract delta version.

## Staged circular references

The source order intentionally creates `OperatingContext` before `OrganizationRoleGrant` and the financial ledger. M1 therefore creates nullable `role_grant_id` and `ledger_id` columns. M2 creates and links role grants, then makes `role_grant_id` non-null and adds its composite foreign key. M8 owns the real ledger linkage. No fake grant or ledger identifier is used to satisfy an early foreign key.

M1 creates deterministic pending contexts only for current `company_x`/`company_y` organization or membership evidence. M2 records that legacy observation as E0/pending with null permit, authority, and validity values. These rows do not authorize an active context. No organization is merged, duplicated, or deleted, and no E3 evidence is fabricated.

## Artifact and checksum contract

- Every `PREPARED` or `READY` slot must reference a preflight, apply, and postcheck artifact beneath `server/src/migrations/annex/`.
- Every referenced source has an exact lowercase SHA-256 digest in the manifest.
- Dry-run verifies all three files before reporting the dependency closure.
- Preflight and postcheck SQL are read-only. Apply SQL can contain DDL/DML only for its named stage.
- The plan is executable only when every selected dependency is `READY`; the current M1/M2 closure is explicitly non-executable.
- Promotion to `READY` requires a disposable database, preflight with no blockers, apply, postcheck with no blockers, constraint checks, repeat/recovery tests, and checkpoint evidence.

The future executor must journal migration ID, immutable checksum set, program version, start/end timestamps, status, and batch checkpoint, and must admit only one runner at a time. That executor is not present in PREPARE; a successful dry-run is not a migration execution. M3 additionally owns database-side target, attribution, and high-water-mark checkpoint tables so its data backfill can resume after a committed batch without overwriting unresolved rows.

## Dry-run commands

From the repository root:

```bash
npm run db:migrate:annex:plan
node server/src/migrations/annex/cli.js --dry-run --target=M3 --json
```

The default target is M8. A lower target includes its complete ordered dependency closure. Omitting `--dry-run`, passing an execution-shaped argument, or selecting a target outside M1–M8 fails closed.

## MySQL DDL boundary

MySQL maps `CREATE INDEX` to `ALTER TABLE`, and DDL such as `CREATE TABLE`, `ALTER TABLE`, and `CREATE INDEX` causes implicit commits. A surrounding `BEGIN` therefore is not treated as evidence of an atomic rollback. The execution package must checkpoint each DDL boundary and use reviewed roll-forward recovery rather than a destructive down migration.

The M1/M2 data-copy statements also avoid deprecated `VALUES(column)` references in `ON DUPLICATE KEY UPDATE`. M3 uses conditional DDL plus transactional batches whose attribution write, nullable target update, verification marker, and checkpoint advancement commit together. This is a roll-forward design; it does not claim transactional rollback across MySQL DDL. Successful re-entry still requires the future journal/checksum and single-runner gate.

Primary references:

- [MySQL 8.4 CREATE INDEX Statement](https://dev.mysql.com/doc/refman/8.4/en/create-index.html)
- [MySQL 8.4 Statements That Cause an Implicit Commit](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html)
- [MySQL 8.4 INSERT ... ON DUPLICATE KEY UPDATE](https://dev.mysql.com/doc/refman/8.4/en/insert-on-duplicate.html)

## Promotion and recovery gates

Before any local apply, the operator must provide an explicitly named disposable database and prove backup/restore for the fixture. M1 postcheck must account for every staged context. M2 postcheck must prove context/grant compatibility, membership mapping completeness, and zero legacy-evidence elevation. M3 postcheck must reconcile all 28 target fields with its checkpoint and attribution records while preserving every missing or ambiguous context as NULL. M4 must stop on unresolved backfill; M7 must stop on unresolved active-plate conflicts; M8 must stop on unreconciled balances.

Schema installation and upgrade migrations must eventually converge, but `server/schema.sql` is not modified by this PREPARE correction because M1/M2 have not passed disposable-MySQL validation. Production enablement, feature-flag activation, deploy, push, merge, and production migration remain outside this contract.
