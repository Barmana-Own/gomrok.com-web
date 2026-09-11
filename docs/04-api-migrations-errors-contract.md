# Annex API, Migration, and Error Compatibility Contract

## PREPARE checkpoint

This is a code-derived compatibility map. It does not claim that missing operations exist, that a database migration ran, or that the deployed environment matches this working tree.

| Requirement | Current code point | Status | Prepared change/test boundary |
|---|---|---|---|
| One canonical platform base | `app.use('/api/platform', ...)`; OpenAPI server `/api` plus `/platform/*` paths | IMPLEMENTED | Preserve `/api/platform`; deployment rewrite to `/app/api/platform` is NOT_VERIFIED here |
| Context-list operation | guarded `GET /api/platform/me/contexts` | IMPLEMENTED | Bootstrap projection only; no business data |
| Context switch | guarded `POST /api/auth/context/switch` | IMPLEMENTED | Current context header plus server-side membership and generation validation |
| Canonical/legacy idempotency header | shared resolver | IMPLEMENTED | Header compatibility only; durable request-hash/transaction semantics remain PARTIAL |
| M1–M8 exact order | annex manifest | IMPLEMENTED | M1/M2/M3 PREPARED; no database execution |
| Full 27-operation delta | routes and OpenAPI | PARTIAL | Missing operations remain absent; no placeholder endpoints were added |

## Base-path rule

The code-level platform base is `/api/platform`. OpenAPI expresses this once as server `/api` plus paths beginning `/platform`. The context-list source path `GET /me/contexts` therefore resolves to `GET /api/platform/me/contexts`. Authentication transition routes remain under `/api/auth` and are not duplicated beneath `/api/platform`.

The OpenAPI syntax version remains `3.0.3`. The source contract delta is recorded separately as `info.x-contract-delta-version: '1.4'`; it is not presented as an OpenAPI specification version.

The externally deployed `/app/api` rewrite is environment-specific and was not inspected or changed in this PREPARE checkpoint. A proxy must add the deployment prefix once; clients and OpenAPI must not concatenate `/app` or `/api` twice.

Contract validation is reproducible through the pinned `@redocly/cli` dependency and `npm run api:validate`. The non-deploying GitHub Actions workflow also runs OpenAPI validation, the server tests, the client production build, and syntax checks. A valid YAML result does not imply that the missing operations in the inventory below are implemented.

## Source operation inventory

Status describes semantic completeness, not merely a similarly named route.

| # | Canonical operation | Current implementation or nearest legacy path | Status |
|---:|---|---|---|
| 1 | `GET /me/contexts` | `GET /api/platform/me/contexts` | IMPLEMENTED |
| 2 | `POST /auth/context/switch` | `POST /api/auth/context/switch` | IMPLEMENTED |
| 3 | `GET /organizations/{id}/role-grants` | no HTTP route | MISSING |
| 4 | `POST /organizations/{id}/role-grants` | domain/repository foundation only | PARTIAL |
| 5 | `PATCH /role-grants/{id}/status` | legacy admin qualification is not a role-grant decision API | MISSING |
| 6 | `GET /contexts/{id}/issuer-authorities` | no issuer-authority model/route | MISSING |
| 7 | `GET /contexts/{id}/related-parties` | no context relationship route | MISSING |
| 8 | `POST /eligibility/evaluate` | scattered legacy qualification checks | PARTIAL |
| 9 | `POST /consignments` | `POST /api/platform/cases` is a single-case legacy model | PARTIAL |
| 10 | `GET /consignments/{id}` | `GET /api/platform/cases/{caseId}` | PARTIAL |
| 11 | `GET /consignments/{id}/progress` | state fragments in existing case/trip reads | PARTIAL |
| 12 | `POST /consignments/{id}/capacity-rfq` | `POST /api/platform/cases/{caseId}/capacity-rfq` | PARTIAL |
| 13 | `POST /capacity-rfqs/{id}/commitments` | legacy `POST /api/platform/rfqs/{rfqId}/quotes` | PARTIAL |
| 14 | `GET /capacity-rfqs/{id}/commitments` | legacy organizer pricing projection | PARTIAL |
| 15 | `POST /consignments/{id}/allocation-plan` | no versioned allocation plan | MISSING |
| 16 | `POST /allocation-lots/{id}/award` | legacy RFQ award/trip creation | PARTIAL |
| 17 | `GET /allocation-lots/{id}/vehicles` | carrier network/nomination reads are not lot-scoped | PARTIAL |
| 18 | `POST /allocation-lots/{id}/vehicles` | legacy vehicle creation and trip nomination | PARTIAL |
| 19 | `POST /consignments/{id}/residual-rfq` | no residual-retender operation | MISSING |
| 20 | `GET /consignments/{id}/document-matrix` | no two-level document matrix | MISSING |
| 21 | `POST /introduction-letters` | no introduction-letter aggregate | MISSING |
| 22 | `GET /introduction-letters/{id}` | no introduction-letter read model | MISSING |
| 23 | `GET /loading-schedules/{consignmentId}` | legacy schedule is trip-scoped | PARTIAL |
| 24 | `POST /loading-slots/{id}/book` | no capacity-safe slot reservation | MISSING |
| 25 | `GET /fleet/available` | `/api/platform/carrier/network` is inventory, not the qualified candidate engine | PARTIAL |
| 26 | `POST /fleet/plate-lock/check` | no global advisory check | MISSING |
| 27 | `POST /vehicle-assignments/{id}/substitute` | no atomic substitution workflow | MISSING |

`POST /api/auth/context/select` is a documented engineering extension for consuming the restricted bootstrap session. It is not counted among the 27 source operations and is not a second implementation of context switch.

## Idempotency compatibility

`Idempotency-Key` is canonical and `X-Idempotency-Key` remains an accepted legacy alias. Equal dual headers resolve to one key; conflicting, repeated, empty, malformed, or over-length values fail before idempotency lookup/store and domain work. Missing headers retain each existing endpoint's required/optional behavior.

This is not complete durable idempotency. `platform_idempotency_keys` currently scopes records by tenant, actor, and key and does not yet persist the required context, operation identity, request hash, in-progress/crash recovery state, or transactionally coupled domain result. Award, plate/slot reservation, document issuance, TIR consumption, substitution, and financial release must not claim retry/concurrency safety until those paths and a disposable MySQL integration suite prove it.

## Error registry

The shared registry preserves source-defined HTTP values. `null` means no transport status is approved by the source; it must not be converted to an arbitrary 500/422.

| Code | HTTP | Enforcement/status |
|---|---:|---|
| CTX-001 | 400 | context header missing/malformed/mismatched |
| CTX-002 | 403 | unauthorized same-organization cross-context access |
| CTX-003 | 403 | confidential rate access across contexts |
| CTX-004 | 409 | conflicting active context/session generation |
| AWD-004 | 422 | self-award disclosure approval missing |
| RNK-002 | 500 | ranking invariant plus build failure |
| RNK-003 | — | UI contract-test failure; HTTP unspecified |
| CEG-003 | 403 | invalid role eligibility at evaluation time |
| CEG-004 | 409 | organization-wide suspension used instead of role suspension |
| CNT-005 | 409 | locked case role changed without amendment |
| CNT-006 | 422 | required third-party clause missing |
| FIN-007 | 422 | context ledger separation missing |
| FIN-008 | 422 | demurrage aggregated instead of vehicle-specific |
| FIN-009 | 422 | financing attempted at consignment instead of lot |
| AUD-002 | — | audit acceptance failure; HTTP unspecified |
| CAP-001 | 422 | capacity commitment above approved limit |
| CAP-002 | 500 | residual-retender process failure |
| FLT-006 | 403 | driver/vehicle assignment from FWD context |
| FLT-007 | 409 | active global plate reservation conflict |
| FLT-008 | 422 | substitution without recorded reason |
| TIR-004 | 422 | insufficient carnet inventory for batch |
| DOC-010 | 422 | document granularity conflict |
| GATE-002 | 403 | vehicle gate bypassed by consignment-level approval |
| DOC-001 | — | weight discrepancy; HTTP mapping open |
| POD-003 | — | delivery evidence deficiency; HTTP mapping open |
| INT-001 | — | rolling introduction-letter rule; HTTP mapping open |

No code was invented for the document-issuer-authority failure. That remains an open compatibility decision.

## Legacy error compatibility

| Condition | Existing code | Annex code | Compatibility decision |
|---|---|---|---|
| Direct driver award/assignment from forwarder | `AWD-403` | `FLT-006` | keep existing code until endpoint-specific versioned mapping is implemented and tested |
| Incomplete POD evidence | `POD-424` | `POD-003` | keep existing behavior; new code/status mapping remains open |
| Unauthorized TIR holder | `TIR-424` | `TIR-004` | distinct meanings; never alias authority failure to inventory shortage |
| Generic capacity ineligibility | `CAP-422` | `CAP-001` | distinct meanings; preserve generic legacy contract |
| Locked document | `DOC-423` | `DOC-010` | distinct meanings; preserve lock behavior |
| Settlement condition missing | `FIN-424` | `FIN-007/008/009` | distinct meanings; no broad alias |
| Compliance block | `CMP-451` | none | preserve existing code |

## Migration readiness

M1/M2/M3 are only PREPARED. Their preflight, apply, and postcheck sources are checksum-pinned and the dry-run remains non-executable. M4–M8 are RESERVED. No MySQL connection, schema write, migration journal write, backfill, feature activation, or production action occurred at this checkpoint.

Open decisions remain: historical audit attribution, legal national-identifier conflict handling, issuer-authority error code, HTTP mappings for DOC-001/POD-003/INT-001, M3 backfill ownership for ambiguous rows, M7 historical plate conflicts, and M8 unreconciled balances.

## P11.1 RFQ context/error compatibility

The existing RFQ read paths now route sensitive reads through one repository boundary:

| Endpoint | Context-bound decision | Query guarantee | Error |
|---|---|---|---|
| `GET /api/platform/rfqs?level=RFQ2` | CAR only; active context/grant determine capability; a context-bound CAR list excludes RFQ2 published by the same organization's FWD context while legacy rollout behavior remains unchanged | own quote is joined with an exact bidder predicate; no competitor quote projection is selected | wrong context is HTTP 403 `CTX-002`; CTX-001 remains middleware-level |
| `GET /api/platform/rfqs/{rfqId}` | CAR may read an invited RFQ2 of another organization only as bidder; it cannot inherit access to an RFQ2 published by the same organization's FWD context. FWD may read an invited RFQ1 as bidder or its own RFQ2 as publisher | access is resolved from a minimal RFQ projection and persisted invitation before metadata/case loading; bidder mode never executes the publisher/all-quotes query | same-organization cross-context publisher access, wrong market, or unknown market is HTTP 403 `CTX-002`; absent/uninvited is non-disclosing HTTP 404 `RFQ-404` |
| `GET /api/platform/rfqs/{rfqId}/pricing` | FWD pricing roles only | exact tenant/RFQ/bidder predicate; CAR denial occurs before RFQ or quote lookup | CAR context is HTTP 403 `CTX-003`; legacy unauthorized actors retain `AUTH-403` |

AuthN and `X-Operating-Context` session binding still run before these decisions. Error bodies use the existing `application/problem+json` envelope and disclose neither raw rates nor competing organization/resource identifiers. The OpenAPI responses document CTX-002 and CTX-003 without assigning them a different meaning or status.

At the RFQ read-boundary checkpoint, no migration artifact or checksum changed and M3 remained `RESERVED`. The later P11.1/M3 checkpoint below supersedes only that migration status; it does not change the RFQ behavior or prove M4 complete.

The invitation read uses existing `platform_notifications` plus `platform_domain_events`. The current publication writer still selects recipients from legacy `organization_type`; adapting invitation creation to RoleGrant/OperatingContext is intentionally not included in this read-boundary subpackage and remains a P11 dependency.

## P11.1 M3 nullable transactional context preparation

M3 now has checksum-pinned read-only preflight/postcheck SQL and a resumable apply artifact for 28 semantically named context fields across existing case, contract, RFQ/rate, fleet/coverage, trip, document/POD, loading, relationship-finance, claim/exception, event/notification, contact/export, idempotency, and agent-assignment data. The detailed source-to-context map is in `docs/04-m3-transactional-context-backfill.md`.

All context fields remain nullable. Backfill writes a context only for exactly one candidate, records zero candidates as `MISSING`, records multiple or historically underdetermined candidates as `AMBIGUOUS`, and separates genuinely non-applicable records. Historical `platform_domain_events` and `platform_idempotency_keys` do not contain the active request context, so their actor-only rows are not inferred even when the actor currently has one membership mapping.

M3's database-side target catalog, attribution records, bounded batches, high-water marks, counters, and checkpoints make committed progress resumable. Its postcheck reconciles every source row and returns the full missing/ambiguous review queue without rate, document, evidence, token, or secret payloads. `audit_events` remains untouched because attribution of immutable historical audit is still an open M4/P11.3 preservation decision. `issuer_context_id` remains M5, and financial separation remains M8.

M3 is `PREPARED`, not `READY`. No preflight, apply, postcheck, M1, M2, M3, MySQL connection, or database command was run. M4 mandatory context, broad query enforcement, `ContextAccessLog`, and further `CTX-002`/`CTX-003` work remain outside this checkpoint.
