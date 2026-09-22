# GOMROK Authentication and Authorization Review

## Identity and session model

- Driver and Company Y accounts authenticate with the existing API and receive a 15-minute access token plus a rotating refresh token.
- Shipper, Company X/forwarder, and Agent/Z users authenticate through `POST /api/auth/login-platform` with an IAM-provisioned email/phone credential. The server filters memberships by the requested panel and uses `PLATFORM_TENANT_ID` to select the trusted tenant boundary.
- Governance login remains separate and uses the existing administrator flow.
- Membership context supplies tenant, organization, role, and permission scope; client-supplied ownership is not authoritative.
- Password hashing remains provided by `bcryptjs`; refresh tokens are stored as hashes and revoked on rotation, password change, membership restriction, and session revocation.
- Organization credentials are stored separately in `platform_user_credentials`, are rate-limited and lock after repeated failures, and have no default password or client-supplied role.

## Authorization preservation

- `PlatformWorkspace` still dispatches only to the panel allowed for the authenticated role.
- Panel navigation visibility remains role-sensitive, especially in Admin Governance.
- Server routes continue to enforce role, permission, tenant, organization, relationship, object, and device boundaries.
- RFQ awards, trip readiness, POD acceptance, financial relationships, document access, and critical governance actions remain server-controlled.
- Development preview routes are guarded by `import.meta.env.DEV`; production builds do not render preview workspaces.

## Client security behavior

- Access and refresh tokens remain in session storage as in the existing architecture; no new credential persistence was introduced.
- Logout clears access, refresh, user, and step-up values.
- The redesign does not expose contacts, quote bodies, raw locations, or cross-relationship finance data.
- A panel route never falls back to the driver workspace: an authenticated role mismatch is denied, while an unauthenticated organization route renders its own login form.

## Validation

The existing negative-boundary test suite passed, including role separation, delegated shipper actions, Company X/Y boundaries, driver own-trip scope, Agent assignment scope, tenant substitution rejection, governance redaction, panel-login validation, role filtering, and trusted-tenant scoping.

STAGE_07_STATUS: PASS
NEXT_STAGE: 08-application-security
