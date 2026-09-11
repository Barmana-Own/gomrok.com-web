# M3 Nullable Transactional Context Backfill Contract

## Scope and status

M3 is a schema/backfill preparation artifact for package P11.1. It adds only nullable operating-context relationships to existing sensitive transactional records. It does not make context mandatory, change request authorization, add `CTX-002`/`CTX-003` behavior, or create `ContextAccessLog`. Those controls belong to M4.

The M3 preflight, apply, and postcheck files are checksum-pinned in the annex manifest with state `PREPARED`. They have not been run against MySQL. M1, M2, and M3 therefore remain unexecuted and `NOT_VERIFIED` at database level.

## Attribution rules grounded in the current schema and queries

The source columns below exist in `server/schema.sql`. Query evidence refers to actual reads/writes in `server/src/routes/platform.routes.js`, `server/src/routes/admin.routes.js`, and the operating-context session repository. A context is written only when the candidate set contains exactly one context. Zero candidates remain `MISSING`; more than one remains `AMBIGUOUS`. M3 never chooses one candidate by ordering, organization type, or a default FWD/CAR preference.

| Target | Attribution source | Rule | Missing / ambiguous reason | Current query evidence |
|---|---|---|---|---|
| `shipment_cases.forwarder_context_id` | `x_org_id` | Exact FWD context of X | source/context absent; duplicate candidates | case, RFQ award, contract and trip scope |
| `shipment_cases.carrier_context_id` | `y_org_id` | Exact CAR context of Y | source/context absent; duplicate candidates | case and trip party scope |
| `platform_contracts.forwarder_context_id` | `x_org_id` | Exact FWD context | X/context absent; duplicate candidates | `customer_x` contract writes and reads |
| `rfq_books.publisher_context_id` | `level`, `publisher_org_id` | RFQ2 publisher maps to FWD; RFQ1 publisher is non-applicable customer context | missing RFQ2 context; unsupported level | RFQ1/RFQ2 publication routes |
| `rfq_quotes.bidder_context_id` | parent `rfq_books.level`, `bidder_org_id` | RFQ1 bidder maps to FWD; RFQ2 bidder maps to CAR | missing parent/context; unsupported level | quote role selection is level-dependent |
| `vehicles.carrier_context_id` | `owner_org_id` | Organization-owned vehicle maps to CAR | missing CAR context; `driver:*` owner is non-applicable | carrier network and vehicle routes |
| `carrier_driver_assignments.carrier_context_id` | `y_org_id` | Exact CAR context | context absent; duplicate candidates | carrier coverage and nomination queries |
| `driver_internal_bids.carrier_context_id` | `y_org_id` | Exact CAR context | context absent; duplicate candidates | driver internal bid routes |
| `trip_cases.forwarder_context_id` | `x_org_id` | Exact FWD context | context absent; duplicate candidates | trip party authorization |
| `trip_cases.carrier_context_id` | `y_org_id` | Exact CAR context | context absent; duplicate candidates | trip party authorization |
| `driver_trip_acceptances.carrier_context_id` | parent trip `y_org_id` | Exact CAR context of the trip | missing trip/context | driver acceptance route |
| `driver_delivery_otps.carrier_context_id` | parent trip `y_org_id` | Exact CAR context of the trip | missing trip/context | driver delivery OTP route |
| `platform_trip_events.actor_context_id` | actor membership intersected with trip X/Y | Unique matching trip-party context | missing trip/actor mapping; actor has both contexts | trip-event persistence and reads |
| `platform_documents.owner_context_id` | `owner_org_id` | Only a unique context of the owner; no document-type inference | no owner context; dual-role owner | document owner scope; issuer context is deferred to M5 |
| `pod_cases.carrier_context_id` | parent trip `y_org_id` | Exact CAR context of the trip | missing trip/context | POD joins and lifecycle routes |
| `pod_evidence_versions.carrier_context_id` | POD to trip to `y_org_id` | Exact CAR context of the trip | missing POD/trip/context | POD evidence history |
| `trip_loading_evidence.owner_context_id` | owner organization intersected with trip X/Y | FWD for X, CAR for Y, exactly one only | missing trip/context; same-org dual role | loading-evidence routes |
| `trip_loading_schedules.created_in_context_id` | creator membership intersected with trip X/Y | Exactly one trip-party context | missing trip/membership; dual-role creator; system creator is non-applicable | loading-schedule writes |
| `relationship_ledgers.payer_context_id` | `relationship_type`, `payer_org_id` | `x_y`/`x_agent` payer FWD; `y_driver` payer CAR; customer payer non-applicable | missing role context; unsupported relation | settlement reads/writes |
| `relationship_ledgers.payee_context_id` | `relationship_type`, `payee_org_id` | `customer_x` payee FWD; `x_y` payee CAR; driver/agent payee non-applicable | missing role context; unsupported relation | settlement reads/writes; M8 still owns ledger redesign |
| `platform_claims.opened_in_context_id` | opener user + opener organization membership | Exactly one mapped context | no mapping; dual-role mapping | claim writes and scoped reads |
| `platform_exceptions.opened_in_context_id` | opener user + opener organization membership | Exactly one mapped context | no mapping; dual-role mapping | exception writes and scoped reads |
| `platform_domain_events.actor_context_id` | `actor_user_id` | Historical actor-only rows always remain ambiguous; system rows are non-applicable | original event did not persist active context | event helper and context-switch event repository |
| `platform_notifications.recipient_context_id` | recipient organization and optional user mapping | Exactly one recipient context | no mapping; dual-role recipient | notification fan-out and reads |
| `platform_contact_reveals.actor_context_id` | actor user + organization membership | Exactly one mapped context | no mapping; dual-role mapping | reveal grant writes and reads |
| `platform_export_requests.requested_in_context_id` | requester user + organization membership | Exactly one mapped context | no mapping; dual-role mapping | export request lifecycle |
| `platform_idempotency_keys.operating_context_id` | `actor_user_id` | Historical rows always remain ambiguous because the active request context was not stored | original request context absent | platform/admin `runWrite`; persistent redesign remains separate |
| `agent_assignments.authorizing_context_id` | `assigned_by_org_id` intersected with trip X/Y | FWD for X or CAR for Y, exactly one only | missing trip/context; same-org dual role | agent assignment writes |

## Deliberate exclusions

| Existing data | Reason it is not assigned by M3 |
|---|---|
| `audit_events` | Historical audit attribution is an open preservation decision. M3 does not mutate immutable audit history or invent a context; M4/P11.3 owns the approved audit strategy. |
| `platform_documents.issuer_context_id` | Issuer authority and issuer context belong to M5/P12. M3 only stages owner context. |
| `agent_delivery_verifications` and `agent_delivery_otps` | Agent is not automatically a FWD/CAR operating context. These records retain their trip/assignment relationships until the non-FWD/CAR ADR is approved. |
| `drivers`, driver documents and devices | A driver can have several carrier coverages. Context belongs to the coverage/trip, not globally to the driver identity. |
| CRM/admin governance tables | Their tenant/admin scope is not converted into a commercial FWD/CAR context without an approved service-boundary decision. |

## Resumable apply contract

- Conditional DDL makes re-entry after an implicit-commit interruption possible without dropping objects or data.
- `annex_m3_backfill_targets` records the semantic source and expected context kind for every target.
- `annex_m3_backfill_checkpoints` records a high-water mark, last scanned ID, disposition counters, state, and artifact revision for every target column.
- `annex_m3_context_attributions` records one reconciled result per source row and target column. It stores identifiers and reason codes, not rate values, document payloads, evidence payloads, tokens, or secrets.
- Each batch is one transaction: attribution, nullable target update, applied verification, and checkpoint advancement commit together. A failed batch rolls back and is retried from the prior checkpoint.
- The default batch size is 500 and can be bounded from 1 to 5000 through the execution-session variable `@annex_m3_batch_size`.
- A later run extends a completed high-water mark if new rows appeared. Postcheck fails reconciliation while source rows and checkpoints differ, so a quiescent or compatible dual-write window is still required before promotion.
- Candidate values are copied only when `COUNT(DISTINCT candidate_context_id) = 1`. The `MIN` aggregate in the SQL is evaluated only under that condition and therefore cannot choose among multiple candidates.

## Preflight and postcheck semantics

Preflight is read-only. It checks the selected MySQL version, M1/M2 dependency objects, actual source tables/columns, InnoDB engines, dependency indexes, and compatibility of any partially created M3 columns/control tables. Its sizing result reports the source row count and high-water mark for all 28 target fields.

Postcheck is read-only. Its first result set must be empty. It verifies all nullable columns, indexes, foreign keys, the 28-row target catalog, completed checkpoints, source/attribution reconciliation, counter reconciliation, and successful application of every uniquely resolved context. Subsequent result sets provide:

1. per-target totals for resolved, missing, ambiguous, and non-applicable rows;
2. the complete `MISSING`/`AMBIGUOUS` review queue without business payloads;
3. grouped non-applicable reasons.

Unresolved rows are an expected M3 output, not permission to choose a context. M4 must define and satisfy stricter completeness requirements before any column becomes mandatory or any fail-closed request/query behavior is enabled.

## Execution boundary

The artifacts are preparation only. No migration command, preflight SQL, apply SQL, postcheck SQL, database connection, schema mutation, or backfill was run while preparing M3. Promotion from `PREPARED` requires a separately authorized disposable MySQL database, an immutable checksum match, controlled interruption/re-entry tests, and reviewed missing/ambiguous output.
