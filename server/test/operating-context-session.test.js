import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'synthetic-context-test-secret-000000000000000000000000';
process.env.STEP_UP_SECRET = 'synthetic-context-step-up-00000000000000000000000';
process.env.OPERATING_CONTEXT_SESSIONS_ENABLED = 'true';

const { app } = await import('../src/app.js');
const { JWT_SECRET } = await import('../src/config.js');
const { pool } = await import('../src/db.js');
const {
  OPERATING_CONTEXT_HEADER,
  resolveOperatingContextHeader
} = await import('../src/security/platform-auth.js');
const { assertContextRoleCompatibility } = await import('../src/domain/operating-context-session.js');
const { createOperatingContextSessionService } = await import('../src/services/operating-context-session.service.js');
const { CONTEXT_SESSION_MODES, ERROR_CODES } = await import('../../shared/contract.js');

const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
const sessionId = 'session_context_test_000000000001';

function databaseSession(overrides = {}) {
  return {
    session_id: sessionId,
    tenant_id: 'tenant-context-test',
    user_id: 101,
    origin_membership_id: 201,
    active_membership_id: 201,
    active_organization_id: 'org-context-test',
    active_context_id: 'ctx-car-primary',
    generation: 2,
    session_mode: 'context',
    status: 'active',
    expires_at: future,
    last_switched_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides
  };
}

function databaseAccess(overrides = {}) {
  return {
    membership_id: 201,
    tenant_id: 'tenant-context-test',
    organization_id: 'org-context-test',
    user_id: 101,
    membership_role: 'company_y_owner',
    transaction_role: 'carrier',
    route_scope: '["IR-TR"]',
    country_scope: '["IR","TR"]',
    cargo_scope: '{"categories":["general"]}',
    qualification_state: 'qualified',
    kyc_level: 'verified',
    contract_state: 'active',
    delegation_json: null,
    organization_type: 'company_y',
    external_type: 'carrier',
    external_id: 77,
    context_id: 'ctx-car-primary',
    context_type: 'CAR',
    role_grant_id: 501,
    display_color: '#4363ea',
    role_grant_type: 'CARRIER',
    evidence_level: 'E3',
    ...overrides
  };
}

function issueSessionToken({ mode = 'context', generation = 2, contextId = 'ctx-car-primary', membershipId = 201, organizationId = 'org-context-test', role = 'company_y_owner' } = {}) {
  return jwt.sign({
    sub: '77',
    userId: 101,
    membershipId,
    tenantId: 'tenant-context-test',
    organizationId,
    role,
    sessionId,
    sessionMode: mode,
    sessionGeneration: generation,
    contextId: mode === 'context' ? contextId : null
  }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
}

function installPoolExecute(handler) {
  const original = pool.execute;
  const calls = [];
  pool.execute = async (sql, parameters = []) => {
    calls.push({ sql: String(sql), parameters });
    return handler(String(sql), parameters, calls.length);
  };
  return {
    calls,
    restore() {
      pool.execute = original;
    }
  };
}

function request(path, { method = 'GET', token, headers = {}, body } = {}) {
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

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
    server.once('error', reject);
  });
});

after(async () => {
  if (!server) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('M2 preflight is read-only and guards the required migration boundary', async () => {
  const sql = await readFile(new URL('../src/migrations/annex/sql/M2.preflight.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /\b(?:ALTER|CREATE|INSERT|UPDATE|DELETE|DROP|TRUNCATE|REPLACE|CALL)\b/i);
  for (const marker of [
    'M2_DATABASE_NOT_SELECTED',
    'M2_MYSQL_VERSION_UNSUPPORTED',
    'M2_BASE_TABLE_MISSING',
    'M2_BASE_TABLE_ENGINE_UNSUPPORTED',
    'M2_BASE_COLUMN_MISSING',
    'M2_ROLE_GRANT_STAGING_COLUMN_INVALID',
    'M2_ACTIVE_CONTEXT_WITHOUT_GRANT',
    'M2_BASE_TABLE_COLLATION_UNSUPPORTED',
    'M2_PARTIAL_OBJECT_EXISTS'
  ]) {
    assert.match(sql, new RegExp(marker));
  }
});

test('M2 artifact backfills non-authoritative grant evidence and binds one session context', async () => {
  const sql = await readFile(new URL('../src/migrations/annex/sql/M2.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE organization_role_grants/);
  assert.match(sql, /'E0'[\s\S]*'pending'[\s\S]*CONCAT\('M1:', c\.context_id\)/);
  assert.match(sql, /UPDATE operating_contexts c[\s\S]*SET c\.role_grant_id = g\.id/);
  assert.match(sql, /CREATE TABLE membership_operating_contexts/);
  assert.match(sql, /PRIMARY KEY \(tenant_id, user_id, context_id\)/);
  assert.match(sql, /CREATE TABLE platform_sessions/);
  assert.match(sql, /active_context_id VARCHAR\(128\) NULL/);
  assert.match(sql, /generation BIGINT UNSIGNED NOT NULL DEFAULT 0/);
  assert.match(sql, /CHECK \(session_mode IN \('bootstrap', 'context'\)\)/);
  assert.match(sql, /FOREIGN KEY \([\s\S]*active_context_id[\s\S]*REFERENCES membership_operating_contexts/);
  assert.match(sql, /ADD COLUMN session_generation BIGINT UNSIGNED NULL/);
  assert.doesNotMatch(sql, /'E[123]'[\s\S]{0,160}CONCAT\('M1:'/);
  assert.doesNotMatch(sql, /ON DUPLICATE KEY UPDATE status = VALUES\(status\)/);
});

test('X-Operating-Context is case-insensitive by name and strict by value/cardinality', () => {
  assert.equal(resolveOperatingContextHeader({ headers: { 'x-operating-context': 'ctx-car-primary' } }), 'ctx-car-primary');
  assert.equal(resolveOperatingContextHeader({ headers: { 'X-OpErAtInG-CoNtExT': 'ctx-car-primary' } }), 'ctx-car-primary');
  assert.equal(resolveOperatingContextHeader({ headers: {} }, { required: false }), null);

  for (const requestValue of [
    { headers: {} },
    { headers: { 'x-operating-context': '' } },
    { headers: { 'x-operating-context': ' ctx-car-primary' } },
    { headers: { 'x-operating-context': 'ctx car primary' } },
    { headers: { 'x-operating-context': 'زمینه' } },
    { headers: { 'x-operating-context': 'x'.repeat(129) } },
    { headers: { 'x-operating-context': 'ctx,other' } },
    { headers: { 'x-operating-context': ['ctx', 'ctx'] } },
    { headers: {}, rawHeaders: [OPERATING_CONTEXT_HEADER, 'ctx', OPERATING_CONTEXT_HEADER, 'ctx'] }
  ]) {
    assert.throws(
      () => resolveOperatingContextHeader(requestValue),
      (error) => error.code === ERROR_CODES.CONTEXT_BINDING && error.status === 400
    );
  }
});

test('context access rejects membership-role or legal-grant mismatches', () => {
  const validAccess = {
    contextId: 'ctx-car-primary',
    contextType: 'CAR',
    role: 'company_y_owner',
    roleGrantType: 'CARRIER'
  };
  assert.equal(assertContextRoleCompatibility(validAccess).contextId, 'ctx-car-primary');
  for (const access of [
    { ...validAccess, role: 'company_x_owner' },
    { ...validAccess, roleGrantType: 'FORWARDER' }
  ]) {
    assert.throws(
      () => assertContextRoleCompatibility(access),
      (error) => error.code === 'AUTH-403' && error.status === 403
    );
  }
});

test('login session creation uses bootstrap for multiple contexts and direct binding for one', async (t) => {
  for (const scenario of [
    { name: 'multiple contexts', contexts: [databaseAccess(), databaseAccess({ membership_id: 202, membership_role: 'company_x_owner', context_id: 'ctx-fwd-primary', context_type: 'FWD', role_grant_type: 'FORWARDER' })], mode: 'bootstrap', generation: 0 },
    { name: 'one context', contexts: [databaseAccess()], mode: 'context', generation: 1 }
  ]) {
    await t.test(scenario.name, async () => {
      const statements = [];
      const connection = {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async execute(sql, parameters) {
          statements.push({ sql: String(sql), parameters });
          if (String(sql).includes('FROM organization_memberships m')) return [[databaseAccess({ context_id: null, context_type: null, role_grant_id: null, role_grant_type: null, evidence_level: null })]];
          if (String(sql).includes('SELECT 1 AS mapped_context')) return [[{ mapped_context: 1 }]];
          if (String(sql).includes('FROM membership_operating_contexts mc')) return [scenario.contexts];
          if (String(sql).startsWith('INSERT INTO platform_sessions')) return [{ affectedRows: 1 }];
          if (String(sql).startsWith('INSERT INTO platform_refresh_tokens')) return [{ affectedRows: 1, insertId: 901 }];
          throw new Error(`Unexpected SQL: ${String(sql).slice(0, 100)}`);
        }
      };
      const service = createOperatingContextSessionService({
        execute: async () => [[], []],
        getConnection: async () => connection
      }, {
        now: () => new Date('2026-09-08T08:00:00.000Z'),
        createSessionId: () => sessionId,
        createRefreshToken: () => 'synthetic_refresh_token_00000000000000000001',
        hashToken: () => 'a'.repeat(64)
      });
      const result = await service.startLoginSession({ tenantId: 'tenant-context-test', userId: 101, originMembershipId: 201 });
      assert.equal(result.session.mode, scenario.mode);
      assert.equal(result.session.generation, scenario.generation);
      assert.equal(result.availableContextCount, scenario.contexts.length);
      assert.equal(result.session.activeContextId, scenario.mode === 'context' ? 'ctx-car-primary' : null);
      assert.equal(statements.filter(({ sql }) => sql.startsWith('INSERT INTO platform_sessions')).length, 1);
      assert.equal(statements.filter(({ sql }) => sql.startsWith('INSERT INTO platform_refresh_tokens')).length, 1);
    });
  }
});

test('staged login keeps unmapped users on legacy flow but fails closed for inactive mapped contexts', async (t) => {
  for (const scenario of [
    { name: 'no mapping', mapped: false, errorCode: null },
    { name: 'mapped but inactive', mapped: true, errorCode: 'AUTH-403' }
  ]) {
    await t.test(scenario.name, async () => {
      let inserts = 0;
      let rolledBack = false;
      const connection = {
        async beginTransaction() {},
        async commit() {},
        async rollback() { rolledBack = true; },
        release() {},
        async execute(sql) {
          const statement = String(sql);
          if (statement.includes('FROM organization_memberships m')) return [[databaseAccess({ context_id: null, context_type: null, role_grant_id: null, role_grant_type: null, evidence_level: null })]];
          if (statement.includes('SELECT 1 AS mapped_context')) return [scenario.mapped ? [{ mapped_context: 1 }] : []];
          if (statement.includes('FROM membership_operating_contexts mc')) return [[]];
          if (statement.startsWith('INSERT')) {
            inserts += 1;
            return [{ affectedRows: 1 }];
          }
          throw new Error(`Unexpected staged login SQL: ${statement.slice(0, 100)}`);
        }
      };
      const service = createOperatingContextSessionService({
        execute: async () => [[], []],
        getConnection: async () => connection
      });
      if (scenario.errorCode) {
        await assert.rejects(
          () => service.startLoginSession({ tenantId: 'tenant-context-test', userId: 101, originMembershipId: 201 }),
          (error) => error.code === scenario.errorCode
        );
        assert.equal(rolledBack, true);
      } else {
        assert.equal(await service.startLoginSession({ tenantId: 'tenant-context-test', userId: 101, originMembershipId: 201 }), null);
      }
      assert.equal(inserts, 0);
    });
  }
});

test('context refresh rotation locks session before refresh and keeps the active generation', async () => {
  const statements = [];
  const currentRefresh = {
    id: 880,
    tenant_id: 'tenant-context-test',
    user_id: 101,
    membership_id: 201,
    token_hash: 'b'.repeat(64),
    expires_at: future,
    revoked_at: null,
    rotated_to_hash: null,
    session_id: sessionId,
    session_generation: 2
  };
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql) {
      const statement = String(sql);
      statements.push(statement);
      if (statement.includes('FROM platform_refresh_tokens')) return [[currentRefresh]];
      if (statement.includes('FROM platform_sessions s')) return [[databaseSession()]];
      if (statement.includes('FROM membership_operating_contexts mc')) return [[databaseAccess()]];
      if (statement.startsWith('INSERT INTO platform_refresh_tokens')) return [{ affectedRows: 1, insertId: 881 }];
      if (statement.startsWith('UPDATE platform_refresh_tokens')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected refresh rotation SQL: ${statement.slice(0, 100)}`);
    }
  };
  const service = createOperatingContextSessionService({
    execute: async () => [[], []],
    getConnection: async () => connection
  }, {
    now: () => new Date(),
    createRefreshToken: () => 'rotated_refresh_token_000000000000000000001',
    hashToken: (value) => value.startsWith('current_') ? 'b'.repeat(64) : 'c'.repeat(64)
  });
  const result = await service.rotateContextRefreshToken('current_refresh_token_00000000000000000001');
  assert.equal(result.session.generation, 2);
  assert.equal(result.binding.contextId, 'ctx-car-primary');
  const firstRefreshRead = statements.findIndex((sql) => sql.includes('FROM platform_refresh_tokens'));
  const sessionLock = statements.findIndex((sql) => sql.includes('FROM platform_sessions s') && sql.includes('FOR UPDATE'));
  const refreshLock = statements.findIndex((sql, index) => index > firstRefreshRead && sql.includes('FROM platform_refresh_tokens') && sql.includes('FOR UPDATE'));
  assert.equal(firstRefreshRead >= 0, true);
  assert.equal(statements[firstRefreshRead].includes('FOR UPDATE'), false);
  assert.equal(sessionLock > firstRefreshRead, true);
  assert.equal(refreshLock > sessionLock, true);
});

test('user session revocation atomically revokes refresh credentials and context sessions', async () => {
  const statements = [];
  let committed = false;
  const connection = {
    async beginTransaction() {},
    async commit() { committed = true; },
    async rollback() {},
    release() {},
    async execute(sql, parameters) {
      statements.push({ sql: String(sql), parameters });
      if (String(sql).startsWith('UPDATE platform_refresh_tokens')) return [{ affectedRows: 2 }];
      if (String(sql).startsWith('UPDATE platform_sessions')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected revocation SQL: ${String(sql).slice(0, 100)}`);
    }
  };
  const service = createOperatingContextSessionService({
    execute: async () => [[], []],
    getConnection: async () => connection
  });
  const result = await service.revokeUserSessions({ tenantId: 'tenant-context-test', userId: 101 });
  assert.deepEqual(result, { revokedRefreshTokens: 2, revokedSessions: 1 });
  assert.equal(committed, true);
  assert.equal(statements.length, 2);
  assert.deepEqual(statements[0].parameters, ['tenant-context-test', 101]);
  assert.deepEqual(statements[1].parameters, ['tenant-context-test', 101]);
});

test('context-bound HTTP route rejects missing/mismatched headers and accepts the exact binding', async (t) => {
  const token = issueSessionToken();
  for (const scenario of [
    { name: 'exact header', headers: { [OPERATING_CONTEXT_HEADER]: 'ctx-car-primary' }, status: 200, code: null },
    { name: 'missing header', headers: {}, status: 400, code: 'CTX-001' },
    { name: 'mismatched header', headers: { [OPERATING_CONTEXT_HEADER]: 'ctx-car-other' }, status: 400, code: 'CTX-001' }
  ]) {
    await t.test(scenario.name, async () => {
      const database = installPoolExecute((sql) => {
        if (sql.includes('FROM platform_sessions s')) return [[databaseSession()]];
        if (sql.includes('FROM membership_operating_contexts mc')) return [[databaseAccess()]];
        throw new Error(`Unexpected database access: ${sql.slice(0, 100)}`);
      });
      try {
        const response = await request('/api/platform/context', { token, headers: scenario.headers });
        const body = await response.json();
        assert.equal(response.status, scenario.status);
        if (scenario.code) assert.equal(body.code, scenario.code);
        else {
          assert.equal(body.contextId, 'ctx-car-primary');
          assert.equal(body.contextType, 'CAR');
          assert.equal(body.sessionGeneration, 2);
        }
        assert.equal(database.calls.length, 2);
      } finally {
        database.restore();
      }
    });
  }
});

test('context binding is enforced before route RBAC', async () => {
  const token = issueSessionToken();
  const database = installPoolExecute((sql) => {
    if (sql.includes('FROM platform_sessions s')) return [[databaseSession()]];
    if (sql.includes('FROM membership_operating_contexts mc')) return [[databaseAccess()]];
    throw new Error(`Unexpected database access: ${sql.slice(0, 100)}`);
  });
  try {
    const missingContext = await request('/api/platform/driver/undertaking', { token });
    assert.equal(missingContext.status, 400);
    assert.equal((await missingContext.json()).code, ERROR_CODES.CONTEXT_BINDING);

    const wrongRole = await request('/api/platform/driver/undertaking', {
      token,
      headers: { [OPERATING_CONTEXT_HEADER]: 'ctx-car-primary' }
    });
    assert.equal(wrongRole.status, 403);
    assert.equal((await wrongRole.json()).code, 'AUTH-403');
    assert.equal(database.calls.length, 4);
  } finally {
    database.restore();
  }
});

test('bootstrap session is limited to own context listing and cannot reach business routes', async () => {
  const bootstrapToken = issueSessionToken({ mode: 'bootstrap', generation: 0, contextId: null });
  const origin = databaseAccess({ context_id: null, context_type: null, role_grant_id: null, role_grant_type: null, evidence_level: null });
  const database = installPoolExecute((sql) => {
    if (sql.includes('FROM platform_sessions s')) return [[databaseSession({
      active_membership_id: null,
      active_organization_id: null,
      active_context_id: null,
      generation: 0,
      session_mode: 'bootstrap'
    })]];
    if (sql.includes('FROM organization_memberships m')) return [[origin]];
    if (sql.includes('FROM membership_operating_contexts mc')) return [[databaseAccess(), databaseAccess({ context_id: 'ctx-car-secondary' })]];
    throw new Error(`Unexpected database access: ${sql.slice(0, 100)}`);
  });
  try {
    const listResponse = await request('/api/platform/me/contexts', { token: bootstrapToken });
    const listBody = await listResponse.json();
    assert.equal(listResponse.status, 200);
    assert.equal(listBody.session.mode, 'bootstrap');
    assert.deepEqual(listBody.contexts.map((item) => item.contextId), ['ctx-car-primary', 'ctx-car-secondary']);

    const removedDuplicatePath = await request('/api/auth/contexts', { token: bootstrapToken });
    assert.equal(removedDuplicatePath.status, 404);

    const businessResponse = await request('/api/platform/context', { token: bootstrapToken });
    assert.equal(businessResponse.status, 400);
    assert.equal((await businessResponse.json()).code, ERROR_CODES.CONTEXT_BINDING);
    assert.equal(database.calls.some(({ sql }) => sql.includes('shipment_cases')), false);
  } finally {
    database.restore();
  }
});

test('a mapped user cannot bypass context binding with a pre-M2 legacy access token', async () => {
  const legacyToken = jwt.sign({
    sub: '77',
    userId: 101,
    membershipId: 201,
    tenantId: 'tenant-context-test',
    organizationId: 'org-context-test',
    role: 'company_y_owner'
  }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
  const legacyMembership = {
    membership_id: 201,
    tenant_id: 'tenant-context-test',
    organization_id: 'org-context-test',
    role: 'company_y_owner',
    transaction_role: 'carrier',
    route_scope: null,
    country_scope: null,
    cargo_scope: null,
    qualification_state: 'qualified',
    kyc_level: 'verified',
    contract_state: 'active',
    delegation_json: null,
    organization_type: 'company_y',
    organization_status: 'active',
    external_type: 'carrier',
    external_id: 77
  };
  const database = installPoolExecute((sql) => {
    if (sql.includes('FROM organization_memberships m') && !sql.includes('membership_operating_contexts')) return [[legacyMembership]];
    if (sql.includes('SELECT 1 AS mapped_context')) return [[{ mapped_context: 1 }]];
    throw new Error(`Unexpected legacy bypass database access: ${sql.slice(0, 100)}`);
  });
  try {
    const response = await request('/api/platform/context', { token: legacyToken });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, ERROR_CODES.CONTEXT_BINDING);
    assert.equal(database.calls.length, 2);
  } finally {
    database.restore();
  }
});

test('context selection rotates refresh credentials, records ContextSwitched, and invalidates the old generation', async () => {
  const oldRefresh = 'old_refresh_token_000000000000000000000001';
  const bootstrapToken = issueSessionToken({ mode: 'bootstrap', generation: 0, contextId: null });
  const origin = databaseAccess({ context_id: null, context_type: null, role_grant_id: null, role_grant_type: null, evidence_level: null });
  const target = databaseAccess({ context_id: 'ctx-fwd-primary', context_type: 'FWD', membership_id: 202, membership_role: 'company_x_owner', transaction_role: 'forwarder', role_grant_type: 'FORWARDER' });
  let state = databaseSession({
    active_membership_id: null,
    active_organization_id: null,
    active_context_id: null,
    generation: 0,
    session_mode: 'bootstrap'
  });
  let oldRefreshRevoked = false;
  const events = [];

  const authDatabase = installPoolExecute((sql) => {
    if (sql.includes('FROM platform_sessions s')) return [[state]];
    if (sql.includes('FROM organization_memberships m')) return [[origin]];
    if (sql.includes('FROM membership_operating_contexts mc')) return [[target]];
    throw new Error(`Unexpected auth database access: ${sql.slice(0, 100)}`);
  });
  const originalGetConnection = pool.getConnection;
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql) {
      const statement = String(sql);
      if (statement.includes('FROM platform_sessions s')) return [[state]];
      if (statement.includes('FROM platform_refresh_tokens')) {
        return [[{
          id: 900,
          tenant_id: state.tenant_id,
          user_id: state.user_id,
          membership_id: state.origin_membership_id,
          token_hash: 'not-exposed',
          expires_at: future,
          revoked_at: oldRefreshRevoked ? new Date() : null,
          rotated_to_hash: null,
          session_id: state.session_id,
          session_generation: 0
        }]];
      }
      if (statement.includes('FROM membership_operating_contexts mc')) return [[target]];
      if (statement.startsWith('UPDATE platform_sessions')) {
        state = {
          ...state,
          active_membership_id: target.membership_id,
          active_organization_id: target.organization_id,
          active_context_id: target.context_id,
          generation: 1,
          session_mode: 'context'
        };
        return [{ affectedRows: 1 }];
      }
      if (statement.startsWith('INSERT INTO platform_refresh_tokens')) return [{ affectedRows: 1, insertId: 901 }];
      if (statement.startsWith('UPDATE platform_refresh_tokens')) {
        oldRefreshRevoked = true;
        return [{ affectedRows: 1 }];
      }
      if (statement.startsWith('INSERT INTO platform_domain_events')) {
        events.push(statement);
        return [{ affectedRows: 1, insertId: 902 }];
      }
      throw new Error(`Unexpected transaction SQL: ${statement.slice(0, 100)}`);
    }
  });

  try {
    const response = await request('/api/auth/context/select', {
      method: 'POST',
      token: bootstrapToken,
      body: { targetContextId: 'ctx-fwd-primary', refreshToken: oldRefresh }
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.session.mode, 'context');
    assert.equal(body.session.generation, 1);
    assert.equal(body.session.activeContext.contextId, 'ctx-fwd-primary');
    assert.notEqual(body.refreshToken, oldRefresh);
    assert.match(body.refreshToken, /^[A-Za-z0-9_-]{64}$/);
    const accessClaims = jwt.verify(body.token, JWT_SECRET, { algorithms: ['HS256'] });
    assert.equal(accessClaims.sessionMode, 'context');
    assert.equal(accessClaims.sessionGeneration, 1);
    assert.equal(accessClaims.contextId, 'ctx-fwd-primary');
    assert.equal(accessClaims.membershipId, 202);
  } finally {
    pool.getConnection = originalGetConnection;
    authDatabase.restore();
  }

  assert.equal(state.session_mode, 'context');
  assert.equal(state.generation, 1);
  assert.equal(oldRefreshRevoked, true);
  assert.equal(events.length, 1);
  assert.match(events[0], /ContextSwitched/);

  const staleDatabase = installPoolExecute((sql) => {
    if (sql.includes('FROM platform_sessions s')) return [[state]];
    throw new Error(`Stale token must stop after session lookup: ${sql.slice(0, 100)}`);
  });
  try {
    const staleResponse = await request('/api/platform/me/contexts', { token: bootstrapToken });
    const staleBody = await staleResponse.json();
    assert.equal(staleResponse.status, 409);
    assert.equal(staleBody.code, ERROR_CODES.CONTEXT_SESSION_CONFLICT);
    assert.equal(staleDatabase.calls.length, 1);
  } finally {
    staleDatabase.restore();
  }
});

test('context switch changes the single active binding atomically and rejects the stale access generation', async () => {
  const oldRefresh = 'switch_refresh_token_000000000000000000001';
  const oldAccess = databaseAccess();
  const target = databaseAccess({
    membership_id: 202,
    membership_role: 'company_x_owner',
    transaction_role: 'forwarder',
    context_id: 'ctx-fwd-primary',
    context_type: 'FWD',
    role_grant_id: 502,
    role_grant_type: 'FORWARDER'
  });
  const oldToken = issueSessionToken();
  let state = databaseSession();
  let refreshRevoked = false;
  let switchedEvents = 0;

  const authDatabase = installPoolExecute((sql) => {
    if (sql.includes('FROM platform_sessions s')) return [[state]];
    if (sql.includes('FROM membership_operating_contexts mc')) return [[oldAccess]];
    throw new Error(`Unexpected switch auth database access: ${sql.slice(0, 100)}`);
  });
  const originalGetConnection = pool.getConnection;
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql) {
      const statement = String(sql);
      if (statement.includes('FROM platform_sessions s')) return [[state]];
      if (statement.includes('FROM platform_refresh_tokens')) {
        return [[{
          id: 950,
          tenant_id: state.tenant_id,
          user_id: state.user_id,
          membership_id: state.active_membership_id,
          token_hash: 'not-exposed',
          expires_at: future,
          revoked_at: refreshRevoked ? new Date() : null,
          rotated_to_hash: null,
          session_id: state.session_id,
          session_generation: 2
        }]];
      }
      if (statement.includes('FROM membership_operating_contexts mc')) return [[target]];
      if (statement.startsWith('UPDATE platform_sessions')) {
        state = {
          ...state,
          active_membership_id: target.membership_id,
          active_organization_id: target.organization_id,
          active_context_id: target.context_id,
          generation: 3,
          session_mode: 'context'
        };
        return [{ affectedRows: 1 }];
      }
      if (statement.startsWith('INSERT INTO platform_refresh_tokens')) return [{ affectedRows: 1, insertId: 951 }];
      if (statement.startsWith('UPDATE platform_refresh_tokens')) {
        refreshRevoked = true;
        return [{ affectedRows: 1 }];
      }
      if (statement.startsWith('INSERT INTO platform_domain_events')) {
        switchedEvents += 1;
        return [{ affectedRows: 1, insertId: 952 }];
      }
      throw new Error(`Unexpected switch transaction SQL: ${statement.slice(0, 100)}`);
    }
  });

  try {
    const response = await request('/api/auth/context/switch', {
      method: 'POST',
      token: oldToken,
      headers: { [OPERATING_CONTEXT_HEADER]: 'ctx-car-primary' },
      body: { targetContextId: 'ctx-fwd-primary', refreshToken: oldRefresh }
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.session.generation, 3);
    assert.equal(body.session.activeContext.contextId, 'ctx-fwd-primary');
    const nextClaims = jwt.verify(body.token, JWT_SECRET, { algorithms: ['HS256'] });
    assert.equal(nextClaims.contextId, 'ctx-fwd-primary');
    assert.equal(nextClaims.membershipId, 202);
    assert.equal(nextClaims.role, 'company_x_owner');
    assert.equal(refreshRevoked, true);
    assert.equal(switchedEvents, 1);
  } finally {
    pool.getConnection = originalGetConnection;
    authDatabase.restore();
  }

  const staleDatabase = installPoolExecute((sql) => {
    if (sql.includes('FROM platform_sessions s')) return [[state]];
    throw new Error(`Stale switch must stop after session lookup: ${sql.slice(0, 100)}`);
  });
  try {
    const staleResponse = await request('/api/platform/context', {
      token: oldToken,
      headers: { [OPERATING_CONTEXT_HEADER]: 'ctx-car-primary' }
    });
    assert.equal(staleResponse.status, 409);
    assert.equal((await staleResponse.json()).code, ERROR_CODES.CONTEXT_SESSION_CONFLICT);
    assert.equal(staleDatabase.calls.length, 1);
  } finally {
    staleDatabase.restore();
  }
});

test('CORS and OpenAPI expose the context binding without widening origins', async () => {
  const preflight = await fetch(`${baseUrl}/api/auth/context/switch`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://127.0.0.1:5173',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,x-operating-context,content-type'
    }
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-headers') || '', /X-Operating-Context/i);

  const denied = await fetch(`${baseUrl}/api/auth/context/switch`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://untrusted.invalid', 'Access-Control-Request-Method': 'POST' }
  });
  assert.equal(denied.status, 403);

  const openapi = await readFile(new URL('../../openapi/gomrok-platform-v1.yaml', import.meta.url), 'utf8');
  assert.match(openapi, /^openapi: 3\.0\.3$/m);
  assert.match(openapi, /^  x-contract-delta-version: '1\.4'$/m);
  assert.match(openapi, /\/platform\/me\/contexts:/);
  assert.match(openapi, /\/auth\/context\/select:/);
  assert.match(openapi, /\/auth\/context\/switch:/);
  assert.match(openapi, /name: X-Operating-Context/);
  assert.match(openapi, /CTX-001/);
  assert.match(openapi, /CTX-004/);
});
