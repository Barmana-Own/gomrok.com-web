# Operating Context Foundation

## Scope

This document records the non-deployed M1/M2 foundation for separating an organization's legal qualifications from its application user roles, sessions, and operating contexts. It is an engineering contract, not legal approval and not evidence that any organization holds a real permit.

M1 creates pending operating boundaries and deterministically stages one FWD/CAR context for each unambiguous current Company X/Company Y organization or membership. M2 creates role grants, records every legacy role observation as `E0/pending` without inventing permit evidence, links contexts, and adds the guarded membership/session contract. Cross-context query isolation, issuer authority, self-award, and UI behavior remain in later packages. The context-session feature stays disabled until M1/M2 have passed disposable-MySQL validation, legal evidence has been reviewed, and the required rows are explicitly activated.

## Model

| Concept | Persistence | Responsibility |
|---|---|---|
| Organization | Existing `platform_organizations` | One legal entity record |
| OrganizationRoleGrant | M2 `organization_role_grants` | Evidence-backed FORWARDER or CARRIER qualification with validity and scope |
| OperatingContext | M1 `operating_contexts` | FWD or CAR data partition; staged role-grant and ledger links follow in M2/M8 |
| Panel | Existing client surfaces | Presentation only; never a source of legal authority |
| MembershipContext | New `membership_operating_contexts` | Server-owned link between one active membership and one context access |
| PlatformSession | New `platform_sessions` | Exactly one active context binding and generation per session |

Application roles such as `company_x_owner` are rejected by the legal role-grant validator. A FORWARDER grant maps only to FWD; a CARRIER grant maps only to CAR. Tenant, organization, and persisted grant identifiers must all match before a context can be written.

Evidence levels E0 through E3 are retained as data. E2 is not globally rejected and is not promoted to E3; its limits require a later approved CEG policy.

## Validity decision

As an engineering decision, not a legal statement, grant validity is evaluated as a half-open interval: `valid_from <= at < valid_to`; a null `valid_to` has no upper bound. An active context requires an active grant effective at the evaluation time. Later policy resolution may add role-specific restrictions without rewriting historical grant evidence.

## M1/M2 integrity rules

- M1 first adds a composite unique key to the existing organization identity so tenant-consistent foreign keys can be enforced.
- M1 stages contexts only from existing Company X/Company Y organization and membership evidence. It creates no organization, assigns no legal permit, creates no financial ledger, and activates no context.
- M1 identifiers and partition keys are deterministic over tenant, organization, and context type. One staged context per organization/type prevents duplicate retry effects while allowing one legal entity to have both FWD and CAR contexts.
- `role_grant_id` and `ledger_id` are deliberately nullable in M1 because the required targets do not exist until M2 and M8. This preserves the mandated migration order without a synthetic foreign key.
- M2 creates role-grant records. Legacy application-role observations become only `E0/pending` rows with null permit/authority/validity fields; they cannot satisfy active-context queries.
- M2 links every staged context to its matching grant and then makes `role_grant_id` non-null with a composite tenant/organization foreign key. Grant roles, evidence levels, statuses, active-evidence completeness, and validity order are database-checked.
- M2 stages membership-context mappings as `pending`; it does not grant application access. Explicit qualification review must activate the grant, context, and mapping.
- No duplicate legal entity is merged or removed. Because the current organization table has no canonical legal national-identifier column, conflict resolution remains an explicit later migration decision.
- Each stage has checksum-pinned read-only preflight and postcheck artifacts. Apply execution remains blocked in PREPARE.

## Session and binding contract

- A user with more than one active context receives a bootstrap session that may only list its own safe context projections at `GET /api/platform/me/contexts` and select one context.
- A user with exactly one active context is bound directly to it. A user with no M2 mapping retains the existing legacy membership session during the staged rollout; this is not a substitute for the later context enforcement package. If any mapping exists but none is currently effective, login fails closed instead of falling back to a legacy session.
- A bootstrap token cannot access `/api/platform` business resources.
- Context-bound tokens require exactly one `X-Operating-Context` header. Header names are case-insensitive; the opaque value is case-sensitive and must exactly match the signed claim and current server-side session.
- Missing, repeated, malformed, or mismatched context headers return HTTP 400 `CTX-001`. A stale generation, consumed bootstrap token, concurrent switch loser, or attempt to activate an already-active context returns HTTP 409 `CTX-004`.
- For context sessions, request processing preserves the required order: token authentication, session/header binding, route RBAC, then existing ABAC/purpose checks. A missing context binding is therefore not bypassed by an earlier route-role denial.
- The context supplied in a request body is only a requested destination. It is never authorization. The server resolves access through active user, membership, organization, context, and role-grant records.
- Selection and switch lock the session row, validate the current refresh generation, update the single active membership/context, rotate the refresh token, increment generation, and append `ContextSwitched` in one transaction. A stale access generation is rejected on its next request.
- Context sessions and their refresh credentials have a fixed 30-day expiry; existing access tokens remain short-lived at 15 minutes. Rotation does not silently extend the 30-day session.
- Administrative revocation updates refresh credentials and context-session state in one transaction. Password change stores the new hash, revokes refresh credentials and context sessions, and appends its audit row in one transaction.
- The in-process realtime broker closes stale subscriptions for the switched session generation. Cross-instance invalidation is not claimed; durable/distributed realtime invalidation remains part of the later context-scoped event boundary.
- Lock order is session before refresh token for switch and refresh rotation, avoiding an avoidable deadlock between concurrent operations.
- One `(tenant, user, context)` mapping is permitted. Ambiguous duplicate application-role mappings to the same context must be resolved explicitly rather than selected implicitly.
- Context identifiers use visible ASCII without commas or whitespace and are limited to 128 characters at the HTTP boundary. Refresh tokens are exact base64url-style opaque values; surrounding whitespace is not ignored.

Existing RBAC/ABAC, organization state, purpose scope, step-up checks, and legal-grant validity remain server-side checks. Legacy super-admin bootstrap is not assigned a synthetic operating context.

## Rollout guard

`OPERATING_CONTEXT_SESSIONS_ENABLED=false` is the safe default. It must remain false until M1 and M2 are promoted from `PREPARED`, applied through the reviewed migration process, and context mappings are provisioned. When false, existing login/refresh behavior remains unchanged and the new selection endpoints return a safe unavailable response. Enabling the flag without the schema is an operator error and is not a supported rollout sequence.

## Migration state

`M1.preflight.sql` and `M2.preflight.sql` are read-only and report blocking base/version/partial-object conditions. Their corresponding postchecks prove mapping completeness and ensure the M2 legacy placeholders were not promoted above `E0/pending`. M2 also checks the staged nullable role-grant column and blocks any prematurely active context without a grant. All six artifacts are checksum-pinned in the annex manifest. M1 and M2 are `PREPARED`, not executable: both must pass a separately authorized disposable-MySQL preflight/apply/postcheck/constraint/concurrency check before promotion to `READY`. M3 is now separately `PREPARED` with nullable-only backfill artifacts; M4 through M8 remain `RESERVED`.

MySQL syntax, foreign-key creation, clean apply, repeated-run behavior, legacy-data compatibility, and true two-connection concurrency remain `NOT_VERIFIED` until a specifically authorized disposable MySQL database is available. Production migration is not authorized. The repository write contract loads the role grant by tenant, organization, and grant identifier before validating and inserting a context. The broader grant-mutation race remains outside this session package.

Rollback is intentionally not automated: dropping these tables after they contain qualification evidence would be destructive. A failed pre-production apply requires inspection and a reviewed roll-forward plan; any production rollout additionally requires a backup and restore checkpoint defined by the migration execution package.

## Next boundary

P11/M3–M4 must require context-scoped repositories for sensitive business reads/writes, implement CTX-002/CTX-003 boundaries, and add context-native access/audit evidence. M2 alone does not prove that competitor rates are never loaded, does not provide a global query wall, and does not complete dual-role isolation.

## P11.1 RFQ read boundary checkpoint

This checkpoint adds a code-level, context-scoped repository boundary for existing RFQ object, quote, and internal-pricing reads. It does not run or modify M1, M2, or M3, and it does not claim the global M4 query/audit boundary is complete. In the canonical migration manifest M3 remains the reserved nullable attribution/backfill stage; the requested P11.1 code slice is recorded separately so the fixed M1–M8 order is not relabeled.

| Requirement | Source | Existing point | Prior status | Implemented boundary | Evidence |
|---|---|---|---|---|---|
| CAR must not load competitor rates | 02, DR-03 / T-A1 | `GET /api/platform/rfqs/:rfqId` loaded all quotes then filtered | MISSING | CAR resolves only to bidder mode and SQL includes `bidder_org_id = actor.organizationId` before execution; its list also excludes RFQ2 published by the same organization's FWD context | HTTP integration test rejects any broad quote query and artifact test asserts the list predicate |
| Same legal organization must not collapse FWD/CAR | 02, sections 2-4 to 2-6 | publisher checks used only `organizationId` | MISSING | a CAR context cannot inherit publisher access from the FWD context of the same organization; capability is selected from context and active role-grant type | dual-role same-organization HTTP denial |
| Cross-context object access | 02, DR-02 | generic `AUTH-403` after organization inference | PARTIAL | same-organization publisher access, wrong-market RFQ, and unknown market values fail with HTTP 403 `CTX-002`; an unrelated/uninvited object is indistinguishable from absence with `RFQ-404`; all fail before RFQ metadata, case, or quote loading | HTTP object-boundary tests |
| Confidential FWD pricing from CAR | 02, DR-03 | route-level role denial only | PARTIAL | HTTP 403 `CTX-003` is raised after AuthN/ContextBinding and before RFQ/rate lookup | HTTP pricing denial test |
| Legacy rollout compatibility | 02/04 migration compatibility | unbound membership sessions remain supported while rollout is staged | IMPLEMENTED | legacy organization checks remain in the repository only for actors without context claims | full server regression suite |

The repository deliberately has two quote-query shapes. Bidder reads select only the actor organization's row in SQL. A publisher query may read all submitted rows only after the existing sealed-book deadline rule or an `AWARDED` state. A publisher before the deadline receives an empty result without querying quote rows. RFQ authorization uses a minimal projection and the existing invitation relationship first; metadata and the linked case are loaded only after access succeeds. No rate value, organization identifier of a competitor, or internal reason is included in CTX error responses.

The existing RFQ publication writer still derives candidate notifications from the legacy `platform_organizations.organization_type`. Updating that write path is outside this read-only slice. Consequently, this checkpoint fails closed when a context-bound bidder has no persisted invitation, but does not claim that every dual-role CAR context can already be invited by the current publication flow. That integration remains part of later P11 work.

Existing `QuoteRead` and `QuotePricingRead` records are preserved; no new `ContextAccessLog`, context-native audit schema, or cross-instance alert was added. Those controls and the global prohibition on direct sensitive `pool` reads remain later work. Therefore this checkpoint proves the targeted RFQ boundary, not complete context isolation across every business repository.

RFQ checkpoint validation executed on 2026-09-09: the focused HTTP/repository suite passed 10/10 tests; the complete server suite passed 104/104 tests with zero failures/skips; the client production build transformed 42 modules; changed JavaScript syntax checks passed; OpenAPI validation completed with zero errors and 160 existing contract-quality warnings; the dependency audit reported zero vulnerabilities. At that checkpoint M3/M4 were still `RESERVED`. M3 was later promoted only to `PREPARED`; no database or deployed environment was contacted.
