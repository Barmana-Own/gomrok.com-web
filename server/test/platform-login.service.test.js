import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  PLATFORM_PANEL_ROLE_MAP,
  normalizePlatformLoginIdentifier,
  selectPlatformMembership,
  validatePlatformLoginInput
} from '../src/services/platform-login.service.js';

test('normalizes Persian phone digits and work email identifiers deterministically', () => {
  assert.equal(normalizePlatformLoginIdentifier('۰۹۱۲-۳۴۵-۶۷۸۹'), '09123456789');
  assert.equal(normalizePlatformLoginIdentifier('  Ops@Example.COM '), 'ops@example.com');
});

test('validates panel login input without accepting arbitrary roles or weak passwords', () => {
  const valid = validatePlatformLoginInput({
    panel: 'forwarder',
    identifier: 'ops@example.com',
    password: 'correct-horse-battery-staple',
    role: 'company_x_owner'
  });
  assert.equal(valid.panel, 'forwarder');
  assert.deepEqual(valid.allowedRoles, PLATFORM_PANEL_ROLE_MAP.forwarder);

  assert.throws(
    () => validatePlatformLoginInput({ panel: 'forwarder', identifier: 'ops@example.com', password: 'short' }),
    (error) => error.code === 'AUTH-400' && error.status === 400
  );
  assert.throws(
    () => validatePlatformLoginInput({ panel: 'agent', identifier: 'ops@example.com', password: 'correct-horse-battery-staple', role: 'company_x_owner' }),
    (error) => error.code === 'AUTH-400' && error.status === 400
  );
});

test('selects only memberships that belong to the requested panel and reports safe ambiguity', () => {
  const rows = [
    { membership_id: 101, role: 'company_x_owner', user_id: 7 },
    { membership_id: 102, role: 'company_x_document_expert', user_id: 7 },
    { membership_id: 103, role: 'super_admin', user_id: 7 }
  ];
  const ambiguous = selectPlatformMembership(rows, { allowedRoles: PLATFORM_PANEL_ROLE_MAP.forwarder });
  assert.equal(ambiguous.kind, 'ambiguous');
  assert.deepEqual(ambiguous.roles.map((item) => item.role), ['company_x_owner', 'company_x_document_expert']);
  assert.equal(Object.hasOwn(ambiguous.roles[0], 'organizationId'), false);

  const selected = selectPlatformMembership(rows, {
    allowedRoles: PLATFORM_PANEL_ROLE_MAP.forwarder,
    requestedRole: 'company_x_document_expert'
  });
  assert.equal(selected.kind, 'selected');
  assert.equal(selected.membership.membership_id, 102);
});

test('schema stores platform credentials separately with tenant and user uniqueness', () => {
  const schema = readFileSync(resolve(import.meta.dirname, '..', 'schema.sql'), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS platform_user_credentials/);
  assert.match(schema, /UNIQUE KEY uq_platform_credential_login \(tenant_id, login_identifier_normalized\)/);
  assert.match(schema, /UNIQUE KEY uq_platform_credential_user \(tenant_id, user_id\)/);
  assert.match(schema, /password_hash VARCHAR\(255\) NOT NULL/);
});

test('platform login is scoped to the server-selected tenant', () => {
  const appSource = readFileSync(resolve(import.meta.dirname, '..', 'src', 'app.js'), 'utf8');
  assert.match(appSource, /AND c\.tenant_id = \?/);
  assert.match(appSource, /\[input\.identifier, PLATFORM_TENANT_ID\]/);
});
