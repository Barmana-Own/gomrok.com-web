import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'synthetic-rfq-context-secret-000000000000000000000000';
process.env.STEP_UP_SECRET = 'synthetic-rfq-context-step-up-00000000000000000000';
process.env.OPERATING_CONTEXT_SESSIONS_ENABLED = 'true';

const { app } = await import('../src/app.js');
const { JWT_SECRET } = await import('../src/config.js');
const { pool } = await import('../src/db.js');
const { ERROR_CODES } = await import('../../shared/contract.js');
const { createContextScopedRfqRepository } = await import('../src/repositories/context-scoped-rfq.repository.js');

const tenantId = 'tenant-rfq-context-test';
const organizationId = 'org-dual-role-test';
const sessionId = 's'.repeat(32);
const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

function databaseSession(overrides = {}) {
  return {
    session_id: sessionId,
    tenant_id: tenantId,
    user_id: 701,
    origin_membership_id: 801,
    active_membership_id: 801,
    active_organization_id: organizationId,
    active_context_id: 'ctx-car-rfq-test',
    generation: 1,
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
    membership_id: 801,
    tenant_id: tenantId,
    organization_id: organizationId,
    user_id: 701,
    membership_role: 'company_y_owner',
    transaction_role: 'carrier',
    route_scope: null,
    country_scope: null,
    cargo_scope: null,
    qualification_state: 'qualified',
    kyc_level: 'verified',
    contract_state: 'active',
    delegation_json: null,
    organization_type: 'company_x',
    external_type: 'carrier',
    external_id: 77,
    context_id: 'ctx-car-rfq-test',
    context_type: 'CAR',
    role_grant_id: 901,
    display_color: '#4363ea',
    role_grant_type: 'CARRIER',
    evidence_level: 'E3',
    ...overrides
  };
}

function issueToken({
  contextId = 'ctx-car-rfq-test',
  role = 'company_y_owner',
  membershipId = 801
} = {}) {
  return jwt.sign({
    sub: '77',
    userId: 701,
    membershipId,
    tenantId,
    organizationId,
    role,
    sessionId,
    sessionMode: 'context',
    sessionGeneration: 1,
    contextId
  }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
}

function installPoolExecute(handler) {
  const original = pool.execute;
  const calls = [];
  pool.execute = async (sql, parameters = []) => {
    const call = { sql: String(sql), parameters };
    calls.push(call);
    return handler(call.sql, parameters, calls.length);
  };
  return {
    calls,
    restore() {
      pool.execute = original;
    }
  };
}

function contextRequest(path, { token = issueToken(), contextId = 'ctx-car-rfq-test' } = {}) {
  return fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Operating-Context': contextId
    }
  });
}

function authRows(sql, { session = databaseSession(), access = databaseAccess() } = {}) {
  if (sql.includes('FROM platform_sessions s')) return [[session]];
  if (sql.includes('FROM membership_operating_contexts mc')) return [[access]];
  return null;
}

function rfqRow(overrides = {}) {
  return {
    id: 41,
    tenant_id: tenantId,
    case_id: 51,
    level: 'RFQ2',
    state: 'OPEN',
    publisher_org_id: organizationId,
    awarded_org_id: null,
    deadline_at: future,
    metadata_json: '{}',
    ...overrides
  };
}

function caseRow(overrides = {}) {
  return {
    id: 51,
    tenant_id: tenantId,
    owner_org_id: 'shipper-test',
    x_org_id: organizationId,
    y_org_id: organizationId,
    origin_country: 'IR',
    destination_country: 'TR',
    origin_location: 'Tehran',
    destination_location: 'Istanbul',
    cargo_type: 'general',
    ...overrides
  };
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

test('CAR context reads only its own quote from an accessible RFQ2', async (t) => {
  let quoteQueryCount = 0;
  const stub = installPoolExecute((sql, parameters) => {
    const auth = authRows(sql);
    if (auth) return auth;
    if (sql.includes('FROM rfq_books')) return [[rfqRow({ publisher_org_id: 'org-forwarder-publisher' })]];
    if (sql.includes('FROM platform_notifications n')) {
      assert.match(sql, /e\.entity_type\s*=\s*'rfq'/);
      assert.deepEqual(parameters, [tenantId, organizationId, 41, 'OperationalRFQPublished']);
      return [[{ id: 501 }]];
    }
    if (sql.includes('FROM shipment_cases c')) return [[caseRow({ x_org_id: 'org-forwarder-publisher' })]];
    if (sql.includes('FROM rfq_quotes q')) {
      quoteQueryCount += 1;
      assert.match(sql, /q\.bidder_org_id\s*=\s*\?/);
      assert.deepEqual(parameters, [41, tenantId, organizationId]);
      return [[{
        id: 61,
        bidder_org_id: organizationId,
        bidder_display_name: 'Carrier arm',
        amount: '110.00',
        currency: 'EUR',
        terms_json: '{}',
        qualification_state: 'qualified',
        state: 'SUBMITTED',
        submitted_at: new Date(),
        is_ai_assisted: 0
      }]];
    }
    if (sql.includes('INSERT INTO audit_events')) return [{ insertId: 1 }];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  t.after(() => stub.restore());

  const response = await contextRequest('/api/platform/rfqs/41');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.quoteCount, 1);
  assert.equal(body.quotes[0].bidderOrgId, organizationId);
  assert.equal(quoteQueryCount, 1);
  assert.equal(stub.calls.some(({ sql }) => sql.includes('FROM rfq_quotes q') && !/q\.bidder_org_id\s*=\s*\?/.test(sql)), false);
  assert.doesNotMatch(JSON.stringify(body), /competitor/i);
});

test('an uninvited CAR context receives non-disclosing RFQ-404 without metadata, case, or quote loading', async (t) => {
  const stub = installPoolExecute((sql) => {
    const auth = authRows(sql);
    if (auth) return auth;
    if (sql.includes('FROM rfq_books')) return [[rfqRow({ publisher_org_id: 'org-forwarder-publisher' })]];
    if (sql.includes('FROM platform_notifications n')) return [[]];
    throw new Error(`Unexpected SQL after invitation denial: ${sql}`);
  });
  t.after(() => stub.restore());

  const response = await contextRequest('/api/platform/rfqs/41');
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.code, 'RFQ-404');
  assert.equal(stub.calls.filter(({ sql }) => sql.includes('FROM platform_notifications n')).length, 1);
  assert.equal(stub.calls.some(({ sql }) => sql.includes('metadata_json')), false);
  assert.equal(stub.calls.some(({ sql }) => sql.includes('FROM shipment_cases')), false);
  assert.equal(stub.calls.some(({ sql }) => sql.includes('rfq_quotes')), false);
});

test('CAR access to an RFQ2 published by the FWD context of the same organization fails with CTX-002', async (t) => {
  const stub = installPoolExecute((sql) => {
    const auth = authRows(sql);
    if (auth) return auth;
    if (sql.includes('FROM rfq_books')) return [[rfqRow()]];
    throw new Error(`Unexpected SQL after cross-context denial: ${sql}`);
  });
  t.after(() => stub.restore());

  const response = await contextRequest('/api/platform/rfqs/41');
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.code, ERROR_CODES.CONTEXT_CROSS_SCOPE);
  assert.equal(stub.calls.some(({ sql }) => sql.includes('metadata_json')), false);
  assert.equal(stub.calls.some(({ sql }) => sql.includes('FROM shipment_cases')), false);
  assert.equal(stub.calls.some(({ sql }) => sql.includes('rfq_quotes')), false);
});

test('CAR confidential-pricing request fails with CTX-003 before RFQ or quote lookup', async (t) => {
  const stub = installPoolExecute((sql) => {
    const auth = authRows(sql);
    if (auth) return auth;
    if (sql.includes('rfq_books') || sql.includes('rfq_quotes')) throw new Error('Confidential-rate query must not run.');
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  t.after(() => stub.restore());

  const response = await contextRequest('/api/platform/rfqs/41/pricing');
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.code, ERROR_CODES.CONTEXT_CONFIDENTIAL_RATE);
  assert.equal(stub.calls.some(({ sql }) => sql.includes('rfq_books') || sql.includes('rfq_quotes')), false);
  assert.equal('details' in body, false);
});

test('CAR access to an RFQ1 object fails with CTX-002 before any quote query', async (t) => {
  const stub = installPoolExecute((sql) => {
    const auth = authRows(sql);
    if (auth) return auth;
    if (sql.includes('FROM rfq_books')) return [[rfqRow({ level: 'RFQ1', publisher_org_id: 'shipper-test' })]];
    if (sql.includes('FROM shipment_cases c')) return [[caseRow()]];
    if (sql.includes('rfq_quotes')) throw new Error('Cross-context quote query must not run.');
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  t.after(() => stub.restore());

  const response = await contextRequest('/api/platform/rfqs/41');
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.code, ERROR_CODES.CONTEXT_CROSS_SCOPE);
  assert.equal(stub.calls.some(({ sql }) => sql.includes('rfq_quotes')), false);
  assert.equal(stub.calls.some(({ sql }) => sql.includes('metadata_json')), false);
  assert.equal(stub.calls.some(({ sql }) => sql.includes('FROM shipment_cases')), false);
  assert.equal('details' in body, false);
});

test('an unknown RFQ market fails closed before metadata, case, or quote loading', async (t) => {
  const stub = installPoolExecute((sql) => {
    const auth = authRows(sql);
    if (auth) return auth;
    if (sql.includes('FROM rfq_books')) return [[rfqRow({ level: 'RFQ_UNKNOWN' })]];
    throw new Error(`Unexpected SQL after access denial: ${sql}`);
  });
  t.after(() => stub.restore());

  const response = await contextRequest('/api/platform/rfqs/41');
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.code, ERROR_CODES.CONTEXT_CROSS_SCOPE);
  assert.equal(stub.calls.some(({ sql }) => sql.includes('metadata_json')), false);
  assert.equal(stub.calls.some(({ sql }) => sql.includes('FROM shipment_cases')), false);
  assert.equal(stub.calls.some(({ sql }) => sql.includes('rfq_quotes')), false);
});

test('CAR RFQ list query is bidder-scoped and does not infer legal capability from organization_type', async (t) => {
  const stub = installPoolExecute((sql, parameters) => {
    const auth = authRows(sql);
    if (auth) return auth;
    if (sql.includes('FROM rfq_books r')) {
      assert.match(sql, /q\.bidder_org_id\s*=\s*\?/);
      assert.match(sql, /r\.publisher_org_id\s*<>\s*\?/);
      assert.match(sql, /EXISTS\s*\(/);
      assert.match(sql, /n\.recipient_org_id\s*=\s*\?/);
      assert.match(sql, /AS awarded_to_me/);
      const projection = sql.slice(0, sql.indexOf('FROM rfq_books r'));
      assert.doesNotMatch(projection, /r\.publisher_org_id\s*,/);
      assert.doesNotMatch(projection, /r\.awarded_org_id\s*,/);
      assert.deepEqual(parameters, [organizationId, organizationId, tenantId, 1, organizationId, 1, organizationId]);
      return [[{
        ...rfqRow({ state: 'AWARDED', awarded_org_id: 'competitor-org-secret' }),
        direction: 'EXPORT',
        origin_country: 'IR',
        destination_country: 'TR',
        origin_location: 'Tehran',
        destination_location: 'Istanbul',
        cargo_type: 'general',
        cargo_weight: '25.000',
        cargo_weight_unit: 'TON',
        own_quote_id: null,
        own_quote_amount: null,
        own_quote_currency: null,
        own_quote_state: null,
        own_quote_submitted_at: null,
        awarded_to_me: 0
      }]];
    }
    if (sql.includes('FROM platform_organizations') && sql.includes('organization_type')) {
      throw new Error('Context-bound access must not infer capability from organization_type.');
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  t.after(() => stub.restore());

  const response = await contextRequest('/api/platform/rfqs?level=RFQ2');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.rfqs.length, 1);
  assert.equal(body.rfqs[0].awardedToMe, false);
  assert.doesNotMatch(JSON.stringify(body), /competitor-org-secret/);
  assert.equal(stub.calls.filter(({ sql }) => sql.includes('FROM rfq_books r')).length, 1);
});

test('legacy carrier RFQ listing retains its qualified-organization rollout behavior', async () => {
  const calls = [];
  const repository = createContextScopedRfqRepository({
    async execute(sql, parameters) {
      calls.push({ sql: String(sql), parameters });
      if (String(sql).includes('FROM platform_organizations')) {
        return [[{ organization_type: 'company_y', status: 'active', qualification_state: 'qualified' }]];
      }
      if (String(sql).includes('FROM rfq_books r')) {
        assert.deepEqual(parameters, [organizationId, organizationId, tenantId, 0, organizationId, 0, organizationId]);
        return [[]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  });

  const rows = await repository.listCarrierRfqs({
    actor: { tenantId, organizationId, role: 'company_y_owner' }
  });

  assert.deepEqual(rows, []);
  assert.equal(calls.length, 2);
});

test('only an FWD publisher after the sealed window may execute the all-quotes query', async () => {
  const calls = [];
  const repository = createContextScopedRfqRepository({
    async execute(sql, parameters) {
      calls.push({ sql: String(sql), parameters });
      return [[{ id: 61 }, { id: 62 }]];
    }
  });
  const actor = {
    tenantId,
    organizationId,
    role: 'company_x_owner',
    contextId: 'ctx-fwd-rfq-test',
    contextType: 'FWD',
    contextRoleGrantType: 'FORWARDER'
  };
  const openRfq = rfqRow({ state: 'OPEN', deadline_at: future });

  const sealed = await repository.readVisibleQuotes({ actor, rfq: openRfq });
  assert.deepEqual(sealed.rows, []);
  assert.equal(calls.length, 0);

  const awarded = await repository.readVisibleQuotes({ actor, rfq: { ...openRfq, state: 'AWARDED' } });
  assert.equal(awarded.rows.length, 2);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].sql, /q\.bidder_org_id\s*=\s*\?/);
  assert.deepEqual(calls[0].parameters, [41, tenantId]);
});

test('RFQ HTTP reads use the context-scoped repository instead of loading all quotes then filtering', async () => {
  const routeSource = await readFile(new URL('../src/routes/platform.routes.js', import.meta.url), 'utf8');
  const repositorySource = await readFile(new URL('../src/repositories/context-scoped-rfq.repository.js', import.meta.url), 'utf8');

  assert.match(routeSource, /createContextScopedRfqRepository\(pool\)/);
  assert.doesNotMatch(routeSource, /quotes\.filter\(canSee\)/);
  assert.doesNotMatch(routeSource, /\bcanReadQuote\b/);
  assert.match(repositorySource, /AND q\.bidder_org_id = \?/);
  assert.match(repositorySource, /r\.publisher_org_id <> \?/);
  assert.match(repositorySource, /n\.recipient_org_id = \?/);
  assert.match(repositorySource, /assertConfidentialRateAccess\(actor\)/);
});
