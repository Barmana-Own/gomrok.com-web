# Idempotency header compatibility contract

## Scope

This contract covers only resolution of the HTTP idempotency header already consumed by current server write paths. It does not redesign idempotency persistence, replay semantics, locking, transactions, or operation/request scoping.

## Header contract

| Input | Result |
|---|---|
| `Idempotency-Key` only | Accepted as the canonical key. |
| `X-Idempotency-Key` only | Accepted as the legacy-compatible key. |
| Both headers with identical values | Resolved to one key. |
| Both headers with different values | Rejected as ambiguous; neither header takes precedence. |
| Neither header | Existing endpoint behavior is preserved. Routes that already require a key return `AUTH-428`; routes that do not use idempotency remain unaffected. |

Header names are case-insensitive. Resolved values are opaque and case-sensitive.

The legacy name remains accepted. This package does not assign a removal date.

## Engineering decisions

The following validation details are engineering decisions for the current implementation, not requirements asserted by the structural annex PDF:

- Optional HTTP whitespace surrounding a single value is removed before comparison.
- A value must contain 1–128 characters from the documented ASCII set implemented by the shared resolver; internal whitespace, commas, control/non-ASCII characters, and values longer than 128 characters are rejected.
- The resolver never truncates values. In particular, different values with a long common prefix cannot become equal through truncation.
- Repeated instances of the same header are rejected, even when their values are equal. A comma-bearing combined value is also rejected rather than interpreted as a list.
- If one supplied alias is malformed, the valid-looking alias does not override it.

## Error contract

Malformed, repeated, or conflicting idempotency headers return HTTP `400` with code `IDEM-400` in the existing `application/problem+json` envelope on platform and governance write paths. This is an idempotency-header contract error, not a ContextBinding (`CTX-*`) error. Responses and logs do not include either raw key value.

Missing headers on endpoints that already require a key continue to return HTTP `428` with code `AUTH-428`. This package does not make the header globally mandatory.

## CORS

The existing CORS origin allowlist is unchanged. Preflight responses allow both `Idempotency-Key` and `X-Idempotency-Key`.

## OpenAPI representation

OpenAPI 3.0 cannot express alternative names for one header as a standard parameter constraint. The shared `IdempotencyKey` parameter therefore documents `Idempotency-Key` as canonical and records `X-Idempotency-Key` through `x-legacy-alias` and `x-required-one-of`. Runtime enforcement remains authoritative.

## Explicit limitations

This sub-package is not a complete idempotency implementation and does not prove the safety of financial operations or concurrent requests. Context/operation/request hashing, atomic domain-operation coupling, durable in-progress ownership, replay redesign, and concurrency guarantees remain outside this scope. The existing `platform_idempotency_keys.idempotency_key` column inherits a case-insensitive table collation; its cross-request persistence semantics therefore require a later storage/migration decision even though dual-header conflict comparison in this resolver is exact and case-sensitive.
