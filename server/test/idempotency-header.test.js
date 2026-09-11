import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { JWT_SECRET } from '../src/config.js';
import { pool } from '../src/db.js';
import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  resolveIdempotencyKey
} from '../src/security/platform-auth.js';
import { ERROR_CODES } from '../../shared/contract.js';

const actor = Object.freeze({
  userId: 101,
  membershipId: 201,
  tenantId: 'tenant-idempotency-test',
  organizationId: 'shipper-idempotency-test',
  role: 'shipper_admin'
});

const membership = Object.freeze({
  membership_id: actor.membershipId,
  tenant_id: actor.tenantId,
  organization_id: actor.organizationId,
  role: actor.role,
  transaction_role: null,
  route_scope: null,
  country_scope: null,
  cargo_scope: null,
  qualification_state: 'qualified',
  kyc_level: 'verified',
  contract_state: 'active',
  delegation_json: null,
  organization_type: 'shipper',
  organization_status: 'active',
  external_type: null,
  external_id: null
});

function issueAccessToken(subject) {
  return jwt.sign({
    sub: String(subject.userId),
    userId: subject.userId,
    membershipId: subject.membershipId,
    tenantId: subject.tenantId,
    organizationId: subject.organizationId,
    role: subject.role
  }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
}

const accessToken = issueAccessToken(actor);

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
    server.once('error', reject);
  });
});

after(async () => {
  if (!server) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

function requestWithHeaders(headers = {}, rawHeaders = null) {
  return { headers, ...(rawHeaders ? { rawHeaders } : {}) };
}

function assertIdempotencyError(callback) {
  assert.throws(callback, (error) => {
    assert.equal(error.code, ERROR_CODES.IDEMPOTENCY_HEADER);
    assert.equal(error.status, 400);
    return true;
  });
}

function installDatabaseStub({ replayKey = null, membershipRecord = membership } = {}) {
  const originalExecute = pool.execute;
  const calls = [];
  pool.execute = async (statement, parameters = []) => {
    const sql = String(statement);
    calls.push({ sql, parameters });
    if (sql.includes('FROM organization_memberships m')) return [[membershipRecord]];
    if (sql.includes('FROM platform_idempotency_keys')) {
      assert.equal(parameters[2], replayKey);
      return [[{ status_code: 200, response_json: JSON.stringify({ replayed: true }) }]];
    }
    throw new Error(`Unexpected database access in idempotency route test: ${sql.slice(0, 80)}`);
  };
  return {
    calls,
    restore() {
      pool.execute = originalExecute;
    }
  };
}

async function platformRequest(path, { method = 'GET', headers = {}, body, token = accessToken } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

test('resolver accepts the canonical Idempotency-Key header', () => {
  assert.equal(resolveIdempotencyKey(requestWithHeaders({ 'idempotency-key': 'canonical-123' })), 'canonical-123');
});

test('resolver preserves the legacy X-Idempotency-Key header', () => {
  assert.equal(resolveIdempotencyKey(requestWithHeaders({ 'x-idempotency-key': 'legacy-123' })), 'legacy-123');
});

test('resolver collapses equal canonical and legacy values to one key', () => {
  assert.equal(resolveIdempotencyKey(requestWithHeaders({
    'idempotency-key': 'same-123',
    'x-idempotency-key': 'same-123'
  })), 'same-123');
});

test('resolver removes only surrounding HTTP optional whitespace', () => {
  assert.equal(resolveIdempotencyKey(requestWithHeaders({ 'idempotency-key': ' \tows-key\t ' })), 'ows-key');
  assertIdempotencyError(() => resolveIdempotencyKey(requestWithHeaders({ 'idempotency-key': '\u00a0unicode-space\u00a0' })));
});

test('resolver rejects conflicting values without exposing either raw key', () => {
  const canonical = 'canonical-secret-value';
  const legacy = 'legacy-secret-value';
  assert.throws(
    () => resolveIdempotencyKey(requestWithHeaders({
      'idempotency-key': canonical,
      'x-idempotency-key': legacy
    })),
    (error) => {
      assert.equal(error.code, ERROR_CODES.IDEMPOTENCY_HEADER);
      assert.equal(error.status, 400);
      assert.equal(error.message.includes(canonical), false);
      assert.equal(error.message.includes(legacy), false);
      return true;
    }
  );
  assertIdempotencyError(() => resolveIdempotencyKey(requestWithHeaders({
    'idempotency-key': 'Case-Sensitive-Key',
    'x-idempotency-key': 'case-sensitive-key'
  })));
});

test('header names are resolved case-insensitively', () => {
  assert.equal(resolveIdempotencyKey(requestWithHeaders({ 'IdEmPoTeNcY-KeY': 'mixed-case-name' })), 'mixed-case-name');
  assert.equal(resolveIdempotencyKey(requestWithHeaders({ 'X-IDEMPOTENCY-KEY': 'legacy-upper-name' })), 'legacy-upper-name');
});

test('different values with a shared 128-character prefix are never truncated into equality', () => {
  const sharedPrefix = 'a'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH);
  assertIdempotencyError(() => resolveIdempotencyKey(requestWithHeaders({
    'idempotency-key': `${sharedPrefix}x`,
    'x-idempotency-key': `${sharedPrefix}y`
  })));
});

test('absent headers resolve to null without making unrelated endpoints require a key', () => {
  assert.equal(resolveIdempotencyKey(requestWithHeaders({})), null);
});

test('blank, oversized, non-ASCII, whitespace-bearing, and comma-bearing values are rejected', () => {
  const invalidValues = [
    '',
    '   ',
    'a'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1),
    'کلید-۱',
    'two words',
    'first,second'
  ];
  for (const value of invalidValues) {
    assertIdempotencyError(() => resolveIdempotencyKey(requestWithHeaders({ 'idempotency-key': value })));
  }
});

test('multiple values for either header are rejected even when duplicates are equal', () => {
  assertIdempotencyError(() => resolveIdempotencyKey(requestWithHeaders({ 'idempotency-key': ['duplicate', 'duplicate'] })));
  assertIdempotencyError(() => resolveIdempotencyKey(requestWithHeaders({}, [
    'Idempotency-Key', 'duplicate',
    'idempotency-key', 'duplicate'
  ])));
});

test('real platform write route accepts canonical, legacy, and equal dual headers', async (t) => {
  const scenarios = [
    { name: 'canonical', headers: { 'Idempotency-Key': 'route-canonical' }, key: 'route-canonical' },
    { name: 'legacy', headers: { 'X-Idempotency-Key': 'route-legacy' }, key: 'route-legacy' },
    {
      name: 'equal dual headers',
      headers: { 'Idempotency-Key': 'route-dual', 'X-Idempotency-Key': 'route-dual' },
      key: 'route-dual'
    }
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const database = installDatabaseStub({ replayKey: scenario.key });
      try {
        const response = await platformRequest('/api/platform/cases', {
          method: 'POST',
          headers: scenario.headers,
          body: {}
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { replayed: true });
        assert.equal(database.calls.length, 2);
        assert.match(database.calls[1].sql, /FROM platform_idempotency_keys/);
      } finally {
        database.restore();
      }
    });
  }
});

test('conflicting headers are rejected before idempotency lookup/store and domain work', async () => {
  const canonical = 'route-canonical-secret';
  const legacy = 'route-legacy-secret';
  const database = installDatabaseStub();
  try {
    const response = await platformRequest('/api/platform/cases', {
      method: 'POST',
      headers: { 'Idempotency-Key': canonical, 'X-Idempotency-Key': legacy },
      body: {}
    });
    const rawBody = await response.text();
    const body = JSON.parse(rawBody);
    assert.equal(response.status, 400);
    assert.match(response.headers.get('content-type'), /^application\/problem\+json/);
    assert.equal(body.code, ERROR_CODES.IDEMPOTENCY_HEADER);
    assert.equal(body.status, 400);
    assert.equal(rawBody.includes(canonical), false);
    assert.equal(rawBody.includes(legacy), false);
    assert.equal(database.calls.length, 1);
    assert.match(database.calls[0].sql, /FROM organization_memberships m/);
    assert.equal(database.calls.some(({ sql }) => sql.includes('platform_idempotency_keys')), false);
    assert.equal(database.calls.some(({ sql }) => sql.includes('shipment_cases')), false);
  } finally {
    database.restore();
  }
});

test('admin write path uses the same conflict resolver before governance work', async () => {
  const adminActor = {
    userId: 102,
    membershipId: 202,
    tenantId: actor.tenantId,
    organizationId: 'platform-governance-test',
    role: 'security_admin'
  };
  const adminMembership = {
    ...membership,
    membership_id: adminActor.membershipId,
    organization_id: adminActor.organizationId,
    role: adminActor.role,
    organization_type: 'platform'
  };
  const database = installDatabaseStub({ membershipRecord: adminMembership });
  try {
    const response = await platformRequest('/api/platform/admin/users/9/sessions/revoke', {
      method: 'POST',
      token: issueAccessToken(adminActor),
      headers: {
        'X-Purpose-Scope': 'security-session-review',
        'Idempotency-Key': 'admin-canonical',
        'X-Idempotency-Key': 'admin-legacy'
      },
      body: {}
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, ERROR_CODES.IDEMPOTENCY_HEADER);
    assert.equal(database.calls.length, 1);
    assert.equal(database.calls.some(({ sql }) => sql.includes('platform_idempotency_keys')), false);
    assert.equal(database.calls.some(({ sql }) => sql.includes('platform_refresh_tokens')), false);
  } finally {
    database.restore();
  }
});

test('account password path uses the same conflict resolver before account work', async () => {
  const driverActor = {
    userId: 103,
    membershipId: 203,
    tenantId: actor.tenantId,
    organizationId: 'driver-idempotency-test',
    role: 'driver'
  };
  const driverMembership = {
    ...membership,
    membership_id: driverActor.membershipId,
    organization_id: driverActor.organizationId,
    role: driverActor.role,
    organization_type: 'driver',
    external_type: 'driver',
    external_id: 303
  };
  const database = installDatabaseStub({ membershipRecord: driverMembership });
  try {
    const response = await platformRequest('/api/auth/change-password', {
      method: 'POST',
      token: issueAccessToken(driverActor),
      headers: {
        'Idempotency-Key': 'password-canonical',
        'X-Idempotency-Key': 'password-legacy'
      },
      body: {}
    });
    assert.equal(response.status, 400);
    assert.match(response.headers.get('content-type'), /^application\/problem\+json/);
    assert.equal((await response.json()).code, ERROR_CODES.IDEMPOTENCY_HEADER);
    assert.equal(database.calls.length, 1);
    assert.equal(database.calls.some(({ sql }) => /FROM (drivers|carriers)/.test(sql)), false);
  } finally {
    database.restore();
  }
});

test('missing headers retain required and non-idempotent route behavior', async () => {
  const database = installDatabaseStub();
  try {
    const requiredResponse = await platformRequest('/api/platform/cases', { method: 'POST', body: {} });
    assert.equal(requiredResponse.status, 428);
    assert.equal((await requiredResponse.json()).code, 'AUTH-428');
    assert.equal(database.calls.length, 1);

    const optionalResponse = await platformRequest('/api/platform/context');
    assert.equal(optionalResponse.status, 200);
    assert.equal((await optionalResponse.json()).role, actor.role);
    assert.equal(database.calls.length, 2);
    assert.equal(database.calls.some(({ sql }) => sql.includes('platform_idempotency_keys')), false);
  } finally {
    database.restore();
  }
});

test('CORS preflight permits canonical and legacy header names without changing origins', async () => {
  const response = await fetch(`${baseUrl}/api/platform/cases`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://127.0.0.1:5083',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Idempotency-Key, X-Idempotency-Key'
    }
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5083');
  const allowedHeaders = response.headers.get('access-control-allow-headers')
    .split(',')
    .map((value) => value.trim().toLowerCase());
  assert.ok(allowedHeaders.includes('idempotency-key'));
  assert.ok(allowedHeaders.includes('x-idempotency-key'));
});

test('OpenAPI contract identifies the canonical header, legacy alias, and conflict code', () => {
  const openApi = readFileSync(new URL('../../openapi/gomrok-platform-v1.yaml', import.meta.url), 'utf8');
  assert.match(openApi, /IdempotencyKey:\s*\r?\n\s+name: Idempotency-Key/);
  assert.match(openApi, /x-legacy-alias: X-Idempotency-Key/);
  assert.match(openApi, /HTTP 400 with code IDEM-400/);
  assert.match(openApi, /InvalidIdempotencyHeader:/);
  assert.match(openApi, /'400':\s*\r?\n\s+\$ref: '#\/components\/responses\/InvalidIdempotencyHeader'/);
});
