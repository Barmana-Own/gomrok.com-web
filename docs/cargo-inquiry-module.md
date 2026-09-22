# Shared Cargo Inquiry Module

## Scope

This module implements the shared cargo-intake flow described in the supplied product specification v1.0 (2026-09-22). A guest can complete one mobile-first RTL form with nine stages and choose either:

- `استعلام خودکار از رانندگان`: stores a guest draft, requires an authenticated shipper continuation, and publishes the owned version only after server validation.
- `استعلام توسط پشتیبانی`: validates and places the request in the support queue without requiring membership.

The automatic path treats draft creation, publication, offer receipt, offer selection, and transport execution as separate states. It does not calculate an instant algorithmic freight price and does not create a contract, payment, customs approval, GPS trip, or insurance record.

The nine stages cover route and stops, schedule, cargo identity, packaging/weight/volume/dimensions, vehicle and equipment, conditional special-cargo requirements, origin/destination services, documents/contact/payer, and final review/consent. The normalized payload keeps the form version, structured stops/items/special requirements, support-only messages, consent records, publication broadcasts, offer revisions, and risk-review decisions separately addressable.

## Implemented surfaces

- Public form: `/app/quote` (with `/app/inquiry` as a compatible alias).
- Shipper continuation: `/app/shipper?continuationKey=...`.
- Shipper inquiry list and version-scoped driver offers are available from the `استعلام‌های ثبت‌شده` panel section.
- The driver opportunity panel reads the privacy-safe market projection and can create or update one version-scoped offer per driver.
- Support queue endpoints are server-side role protected.
- The form preserves a local draft and a stable idempotency key, but does not present local files as uploaded: real private storage and scanning remain disabled until a provider is configured.

## Server contract

| Operation | Method and path | Access | Behavior |
| --- | --- | --- | --- |
| Create guest automatic draft | `POST /api/cargo-inquiries/drafts` | Guest | Creates a versioned draft and returns a one-time continuation token. |
| Update guest draft | `PATCH /api/cargo-inquiries/:publicId/draft` | Guest continuation token | Appends a new version; does not overwrite history. |
| Submit to support | `POST /api/cargo-inquiries/support` | Guest | Creates a support queue case and tracking code. |
| Read guest support status | `GET /api/cargo-inquiries/support/:publicId` | Guest access token | Returns guest-safe status and any recorded support response. |
| Read/validate guest inquiry | `GET /api/cargo-inquiries/:publicId/status`, `GET /api/cargo-inquiries/:publicId/validate` | Guest access token | Returns status or the current server validation decision. |
| Auth handoff | `POST /api/cargo-inquiries/:publicId/auth-handoff` | Guest access token | Confirms the one-time continuation target before sign-in. |
| Support queue | `GET /api/cargo-inquiries/support/queue` | Support role | Lists queued and assigned support cases. |
| Assign/respond support case | `POST /api/cargo-inquiries/support/:publicId/assign`, `/respond`, `/quote` | Support role | Assigns a case or records versioned support prices. |
| Support review actions | `POST /api/cargo-inquiries/support/:publicId/request-info`, `/approve-risk`, `/send-to-customer` | Support role | Requests missing information, records a risk decision, or queues notification delivery. |
| Support quote history | `GET /api/cargo-inquiries/support/:publicId/quotes` | Support role | Lists versioned manual quotes and their validity. |
| Bind draft to shipper | `POST /api/cargo-inquiries/:publicId/continue` | Shipper create permission | Binds the draft to the authenticated organization and revokes guest continuation. |
| Publish automatic inquiry | `POST /api/cargo-inquiries/:publicId/submit-automatic` or `/submit` | Shipper create permission | Revalidates the current version and publishes, holds for review, or reports missing data. |
| Driver opportunities | `GET /api/cargo-inquiries/driver/opportunities` | Eligible driver | Returns a privacy-safe projection only. |
| Driver offer | `POST /api/cargo-inquiries/:publicId/offers` | Eligible driver | One active offer per driver/request/version, protected by row locking and a unique key. |
| Shipper offers | `GET /api/cargo-inquiries/:publicId/offers` | Owning shipper | Returns only offers for the current version. |
| Select offer | `POST /api/cargo-inquiries/:publicId/select-offer` | Shipper approval permission | Locks the inquiry and offer rows before selecting exactly one offer. |
| Document lifecycle | `POST /api/cargo-inquiries/:publicId/documents/init`, `/complete`, `DELETE`, `GET` | Authorized guest/member | Explicitly returns `503 FILE_STORAGE_NOT_CONFIGURED` until private storage and scanning are configured; no fake upload succeeds. |

## Data and safety controls

- `cargo_inquiries`, `cargo_inquiry_versions`, `cargo_inquiry_publications`, `cargo_inquiry_offers`, `cargo_support_cases`, `cargo_inquiry_files`, `cargo_inquiry_events`, stops/items/special requirements, broadcasts, offer revisions, support quotes, messages, consents, notification deliveries, risk reviews, idempotency keys, rule versions, and vehicle capability rules are additive schema artifacts.
- The migration is present at `server/migrations/20260922_cargo-inquiry.sql` and has not been executed by this change.
- Guest continuation is checked by a hash and retained encrypted only for idempotent replay; it is single-use after ownership binding and is revoked on binding.
- Idempotency keys, version numbers, server-side validation, tenant/organization ownership checks, row locks, the unique draft-version key, and the unique driver-offer key protect retry and concurrency boundaries.
- Driver projections omit exact addresses, requester contact data, value, and budget by default.
- Dangerous, pharmaceutical, oversized, live-biological, and uncertain cargo is held for specialist review rather than silently published.
- Weight units are normalized to kilograms; explicit total weight is not multiplied by handling-unit quantity. Dimensions produce a cubic-meter estimate and liquid volume is not converted to weight without density data.
- Monetary values use integer minor units in offer/support response payloads, with an explicit currency code and separate included/excluded service fields. UI conversion to toman is not mixed into server calculations.
- Status output distinguishes lifecycle concepts such as `DRAFT`, `AUTH_REQUIRED`, `AWAITING_REVIEW`, `SUPPORT_QUEUE`, `AWAITING_CUSTOMER_INFO`, `AWAITING_RISK_APPROVAL`, `READY_FOR_DRIVER_MATCHING`, `OPEN_FOR_QUOTES`, `QUOTES_RECEIVED`, `QUOTE_SELECTED`, `CANCELLED_BY_SHIPPER`, and `EXPIRED`.

## Deliberate follow-up work

- A production file-storage/scanning provider must be selected before enabling real file uploads. The schema records private/quarantine metadata, but this change does not invent a storage backend or expose unverified files.
- The base automatic scope currently holds multi-stop, multi-vehicle, and non-domestic requests for review. This is the documented launch proposal `ASM-001`, not an irreversible product decision.
- Applying the migration, staging acceptance, production deployment, and live-data verification require separate authorization and are not part of this implementation checkpoint.
