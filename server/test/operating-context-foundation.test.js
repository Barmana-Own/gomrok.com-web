import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  OperatingContextModelError,
  isRoleGrantEffectiveAt,
  validateOperatingContext,
  validateOrganizationRoleGrant
} from '../src/domain/operating-context.js';
import { createOperatingContextRepository } from '../src/repositories/operating-context.repository.js';

const effectiveAt = new Date('2026-09-08T08:00:00.000Z');

function grant(overrides = {}) {
  return {
    id: 41,
    tenantId: 'tenant-a',
    organizationId: 'org-a',
    role: 'FORWARDER',
    permitNo: 'SYNTHETIC-PERMIT-1',
    permitType: 'SYNTHETIC_TEST',
    issuingAuthority: 'SYNTHETIC_TEST_AUTHORITY',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: '2027-01-01T00:00:00.000Z',
    evidenceLevel: 'E2',
    routeScope: ['IR-TR'],
    cargoScope: { categories: ['general'] },
    status: 'active',
    ...overrides
  };
}

function context(overrides = {}) {
  return {
    contextId: 'ctx-fwd-a',
    tenantId: 'tenant-a',
    organizationId: 'org-a',
    roleGrantId: 41,
    contextType: 'FWD',
    dataPartitionKey: 'partition-fwd-a',
    ledgerId: 'ledger-fwd-a',
    displayColor: '#4363ea',
    status: 'active',
    ...overrides
  };
}

test('M1 preflight is read-only and checks the required compatibility boundaries', async () => {
  const sql = await readFile(new URL('../src/migrations/annex/sql/M1.preflight.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /\b(?:ALTER|CREATE|INSERT|UPDATE|DELETE|DROP|TRUNCATE|REPLACE|CALL)\b/i);
  for (const marker of [
    'M1_DATABASE_NOT_SELECTED',
    'M1_MYSQL_VERSION_UNSUPPORTED',
    'M1_BASE_TABLE_MISSING',
    'M1_BASE_TABLE_ENGINE_UNSUPPORTED',
    'M1_BASE_COLUMN_MISSING',
    'M1_BASE_COLUMN_INCOMPATIBLE',
    'M1_ORPHAN_MEMBERSHIP_ORGANIZATION',
    'M1_PARTIAL_OBJECT_EXISTS'
  ]) {
    assert.match(sql, new RegExp(marker));
  }
});

test('M1 creates pending operating contexts without inferring grants, ledgers, or active authority', async () => {
  const sql = await readFile(new URL('../src/migrations/annex/sql/M1.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE operating_contexts/);
  assert.doesNotMatch(sql, /CREATE TABLE organization_role_grants/);
  for (const column of ['role_grant_id', 'data_partition_key', 'ledger_id', 'display_color']) {
    assert.match(sql, new RegExp(`\\b${column}\\b`));
  }
  assert.match(sql, /FOREIGN KEY \(tenant_id, organization_id\)/);
  assert.match(sql, /role_grant_id BIGINT UNSIGNED NULL/);
  assert.match(sql, /ledger_id VARCHAR\(128\) NULL/);
  assert.match(sql, /INSERT INTO operating_contexts/);
  assert.match(sql, /'pending'/);
  assert.doesNotMatch(sql, /INSERT INTO organization_role_grants/);
  assert.doesNotMatch(sql, /\bVALUES\s*\(/i);
});

test('M2 creates grants after contexts and stages legacy role evidence without elevation', async () => {
  const sql = await readFile(new URL('../src/migrations/annex/sql/M2.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE organization_role_grants/);
  for (const column of ['permit_no', 'issuing_authority', 'valid_from', 'valid_to', 'evidence_level', 'route_scope', 'cargo_scope', 'legacy_source_ref']) {
    assert.match(sql, new RegExp(`\\b${column}\\b`));
  }
  assert.match(sql, /'E0'/);
  assert.match(sql, /'pending'/);
  assert.match(sql, /SET c\.role_grant_id = g\.id/);
  assert.match(sql, /MODIFY COLUMN role_grant_id BIGINT UNSIGNED NOT NULL/);
  assert.match(sql, /FOREIGN KEY \(role_grant_id, tenant_id, organization_id\)/);
  assert.doesNotMatch(sql, /(?:'active'\s*,\s*CONCAT\('M1:|CONCAT\('M1:'[\s\S]{0,200}'active')/);
  assert.doesNotMatch(sql, /\bVALUES\s*\(/i);
});

test('M1 and M2 postchecks are read-only and include backfill and non-escalation checks', async () => {
  const [m1, m2] = await Promise.all([
    readFile(new URL('../src/migrations/annex/sql/M1.postcheck.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/migrations/annex/sql/M2.postcheck.sql', import.meta.url), 'utf8')
  ]);
  for (const sql of [m1, m2]) {
    assert.doesNotMatch(sql, /\b(?:ALTER|CREATE|INSERT|UPDATE|DELETE|DROP|TRUNCATE|REPLACE|CALL)\b/i);
  }
  assert.match(m1, /M1_CONTEXT_BACKFILL_MISSING/);
  assert.match(m1, /WHERE c\.context_id IS NULL\s+UNION ALL\s+SELECT/);
  assert.match(m2, /M2_CONTEXT_ROLE_GRANT_MISSING/);
  assert.match(m2, /M2_LEGACY_GRANT_ESCALATED/);
});

test('role grant model keeps legal qualification separate from application roles', () => {
  const value = validateOrganizationRoleGrant(grant({ role: ' forwarder ', evidenceLevel: 'e2' }));
  assert.equal(value.role, 'FORWARDER');
  assert.equal(value.evidenceLevel, 'E2');
  assert.throws(() => validateOrganizationRoleGrant(grant({ role: 'company_x_owner' })), (error) => error instanceof OperatingContextModelError && error.field === 'role');
  assert.throws(() => validateOrganizationRoleGrant(grant({ tenantId: { value: 'tenant-a' } })), (error) => error.field === 'tenantId');
});

test('E2 remains a valid evidence level without being promoted to E3 or rejected globally', () => {
  const value = validateOrganizationRoleGrant(grant({ evidenceLevel: 'E2' }));
  assert.equal(value.evidenceLevel, 'E2');
  assert.equal(isRoleGrantEffectiveAt(value, effectiveAt), true);
});

test('scope values reject non-JSON structures and are detached from caller mutation', () => {
  assert.throws(() => validateOrganizationRoleGrant(grant({ routeScope: { unsafe: () => true } })), (error) => error.field === 'routeScope');
  assert.throws(() => validateOrganizationRoleGrant(grant({ cargoScope: new Date() })), (error) => error.field === 'cargoScope');
  assert.throws(() => validateOrganizationRoleGrant(grant({ routeScope: [Number.POSITIVE_INFINITY] })), (error) => error.field === 'routeScope');
  const circular = {};
  circular.self = circular;
  assert.throws(() => validateOrganizationRoleGrant(grant({ routeScope: circular })), (error) => error.field === 'routeScope');

  const routeScope = { corridors: ['IR-TR'] };
  const value = validateOrganizationRoleGrant(grant({ routeScope }));
  routeScope.corridors.push('IR-IQ');
  assert.deepEqual(value.routeScope, { corridors: ['IR-TR'] });
});

test('role grant validity uses a half-open interval and rejects invalid ranges', () => {
  assert.equal(isRoleGrantEffectiveAt(grant(), new Date('2026-01-01T00:00:00.000Z')), true);
  assert.equal(isRoleGrantEffectiveAt(grant(), new Date('2027-01-01T00:00:00.000Z')), false);
  assert.throws(() => validateOrganizationRoleGrant(grant({ validTo: '2025-12-31T00:00:00.000Z' })), (error) => error.field === 'validTo');
});

test('unreviewed M2 grant evidence remains representable but cannot become effective', () => {
  const pending = validateOrganizationRoleGrant(grant({
    permitNo: null,
    permitType: null,
    issuingAuthority: null,
    validFrom: null,
    validTo: null,
    evidenceLevel: 'E0',
    status: 'pending'
  }));
  assert.equal(pending.permitNo, null);
  assert.equal(isRoleGrantEffectiveAt(pending, effectiveAt), false);
  assert.throws(
    () => validateOrganizationRoleGrant({ ...pending, status: 'active' }),
    (error) => error.field === 'permitNo'
  );
});

test('pending contexts may await M8 ledger linkage but active contexts may not', () => {
  const pendingGrant = grant({
    permitNo: null,
    permitType: null,
    issuingAuthority: null,
    validFrom: null,
    validTo: null,
    evidenceLevel: 'E0',
    status: 'pending'
  });
  const value = validateOperatingContext(
    context({ ledgerId: null, status: 'pending' }),
    { roleGrant: pendingGrant, at: effectiveAt }
  );
  assert.equal(value.ledgerId, null);
  assert.throws(
    () => validateOperatingContext(context({ ledgerId: null }), { roleGrant: grant(), at: effectiveAt }),
    (error) => error.field === 'ledgerId'
  );
});

test('operating context type, tenant, organization, and grant id must match the server-loaded grant', () => {
  const value = validateOperatingContext(context(), { roleGrant: grant(), at: effectiveAt });
  assert.equal(value.contextType, 'FWD');
  assert.throws(() => validateOperatingContext(context({ contextType: 'CAR' }), { roleGrant: grant(), at: effectiveAt }), (error) => error.field === 'contextType');
  assert.throws(() => validateOperatingContext(context({ tenantId: 'tenant-b' }), { roleGrant: grant(), at: effectiveAt }), (error) => error.field === 'tenantId');
  assert.throws(() => validateOperatingContext(context({ organizationId: 'org-b' }), { roleGrant: grant(), at: effectiveAt }), (error) => error.field === 'organizationId');
  assert.throws(() => validateOperatingContext(context({ roleGrantId: 42 }), { roleGrant: grant(), at: effectiveAt }), (error) => error.field === 'roleGrantId');
  assert.throws(() => validateOperatingContext(context({ roleGrantId: [41] }), { roleGrant: grant(), at: effectiveAt }), (error) => error.field === 'roleGrantId');
});

test('active context cannot be built from a pending, suspended, or expired grant', () => {
  for (const status of ['pending', 'suspended', 'expired', 'revoked']) {
    assert.throws(() => validateOperatingContext(context(), { roleGrant: grant({ status }), at: effectiveAt }), (error) => error.field === 'status');
  }
  assert.throws(
    () => validateOperatingContext(context(), { roleGrant: grant(), at: new Date('2027-01-01T00:00:00.000Z') }),
    (error) => error.field === 'status'
  );
});

test('carrier grant maps only to a carrier operating context', () => {
  const carrierGrant = grant({ role: 'CARRIER' });
  const carrierContext = context({ contextType: 'CAR' });
  assert.equal(validateOperatingContext(carrierContext, { roleGrant: carrierGrant, at: effectiveAt }).contextType, 'CAR');
});

test('repository reads are tenant, organization, and context scoped at query time', async () => {
  const calls = [];
  const repository = createOperatingContextRepository({
    async execute(sql, params) {
      calls.push({ sql, params });
      return [[], []];
    }
  });
  assert.equal(await repository.findRoleGrant({ tenantId: 'tenant-a', organizationId: 'org-a', grantId: 41 }), null);
  assert.equal(await repository.findContext({ tenantId: 'tenant-a', organizationId: 'org-a', contextId: 'ctx-a' }), null);
  assert.deepEqual(calls[0].params, ['tenant-a', 'org-a', 41]);
  assert.match(calls[0].sql, /tenant_id = \? AND organization_id = \? AND id = \?/);
  assert.deepEqual(calls[1].params, ['tenant-a', 'org-a', 'ctx-a']);
  assert.match(calls[1].sql, /tenant_id = \? AND organization_id = \? AND context_id = \?/);
});

test('repository does not invent grant or ledger identifiers for an M1 staged context', async () => {
  const repository = createOperatingContextRepository({
    async execute() {
      return [[{
        context_id: 'ctx-staged',
        tenant_id: 'tenant-a',
        organization_id: 'org-a',
        role_grant_id: null,
        context_type: 'FWD',
        data_partition_key: 'partition-staged',
        ledger_id: null,
        display_color: null,
        status: 'pending',
        created_at: effectiveAt,
        updated_at: effectiveAt
      }], []];
    }
  });
  const staged = await repository.findContext({
    tenantId: 'tenant-a',
    organizationId: 'org-a',
    contextId: 'ctx-staged'
  });
  assert.equal(staged.roleGrantId, null);
  assert.equal(staged.ledgerId, null);
});

test('repository validates context against a server-supplied grant before writing', async () => {
  let inserts = 0;
  const repository = createOperatingContextRepository({
    async execute(sql) {
      if (/^INSERT/.test(sql)) inserts += 1;
      return [[], []];
    }
  });
  await assert.rejects(
    () => repository.insertContext(context({ organizationId: 'attacker-org' }), { at: effectiveAt }),
    (error) => error instanceof OperatingContextModelError && error.field === 'roleGrant'
  );
  assert.equal(inserts, 0);
});

test('repository loads the scoped grant before inserting an operating context', async () => {
  const calls = [];
  const repository = createOperatingContextRepository({
    async execute(sql, params) {
      calls.push({ sql, params });
      if (/^SELECT/.test(sql)) {
        return [[{
          id: 41,
          tenant_id: 'tenant-a',
          organization_id: 'org-a',
          role: 'FORWARDER',
          permit_no: 'SYNTHETIC-PERMIT-1',
          permit_type: 'SYNTHETIC_TEST',
          issuing_authority: 'SYNTHETIC_TEST_AUTHORITY',
          valid_from: new Date('2026-01-01T00:00:00.000Z'),
          valid_to: new Date('2027-01-01T00:00:00.000Z'),
          evidence_level: 'E2',
          route_scope: '["IR-TR"]',
          cargo_scope: '{"categories":["general"]}',
          status: 'active'
        }], []];
      }
      return [{ affectedRows: 1 }, []];
    }
  });

  const inserted = await repository.insertContext(context(), { at: effectiveAt });
  assert.equal(inserted.contextId, 'ctx-fwd-a');
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /^SELECT/);
  assert.deepEqual(calls[0].params, ['tenant-a', 'org-a', 41]);
  assert.match(calls[1].sql, /^INSERT INTO operating_contexts/);
});

test('repository writes synthetic role grants with parameterized values', async () => {
  const calls = [];
  const repository = createOperatingContextRepository({
    async execute(sql, params) {
      calls.push({ sql, params });
      return [{ insertId: 77 }, []];
    }
  });
  const inserted = await repository.insertRoleGrant(grant({ id: undefined }));
  assert.equal(inserted.id, 77);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /^INSERT INTO organization_role_grants/);
  assert.equal(calls[0].params[0], 'tenant-a');
  assert.equal(calls[0].params[1], 'org-a');
  assert.equal(calls[0].params[2], 'FORWARDER');
});
