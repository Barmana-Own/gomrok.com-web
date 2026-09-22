import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createAnnexMigrationDryRun, verifyReadyMigrationSources } from '../src/migrations/annex/framework.js';
import { ANNEX_MIGRATION_MANIFEST } from '../src/migrations/annex/manifest.js';

const executeFile = promisify(execFile);
const serverRoot = fileURLToPath(new URL('../', import.meta.url));
const schemaPath = fileURLToPath(new URL('../schema.sql', import.meta.url));
const m1Path = fileURLToPath(new URL('../src/migrations/annex/sql/M1.sql', import.meta.url));
const m2Path = fileURLToPath(new URL('../src/migrations/annex/sql/M2.sql', import.meta.url));
const preflightPath = fileURLToPath(new URL('../src/migrations/annex/sql/M3.preflight.sql', import.meta.url));
const applyPath = fileURLToPath(new URL('../src/migrations/annex/sql/M3.sql', import.meta.url));
const postcheckPath = fileURLToPath(new URL('../src/migrations/annex/sql/M3.postcheck.sql', import.meta.url));

const TARGETS = Object.freeze([
  ['shipment_cases', 'forwarder_context_id'],
  ['shipment_cases', 'carrier_context_id'],
  ['platform_contracts', 'forwarder_context_id'],
  ['rfq_books', 'publisher_context_id'],
  ['rfq_quotes', 'bidder_context_id'],
  ['vehicles', 'carrier_context_id'],
  ['carrier_driver_assignments', 'carrier_context_id'],
  ['driver_internal_bids', 'carrier_context_id'],
  ['trip_cases', 'forwarder_context_id'],
  ['trip_cases', 'carrier_context_id'],
  ['driver_trip_acceptances', 'carrier_context_id'],
  ['driver_delivery_otps', 'carrier_context_id'],
  ['platform_trip_events', 'actor_context_id'],
  ['platform_documents', 'owner_context_id'],
  ['pod_cases', 'carrier_context_id'],
  ['pod_evidence_versions', 'carrier_context_id'],
  ['trip_loading_evidence', 'owner_context_id'],
  ['trip_loading_schedules', 'created_in_context_id'],
  ['relationship_ledgers', 'payer_context_id'],
  ['relationship_ledgers', 'payee_context_id'],
  ['platform_claims', 'opened_in_context_id'],
  ['platform_exceptions', 'opened_in_context_id'],
  ['platform_domain_events', 'actor_context_id'],
  ['platform_notifications', 'recipient_context_id'],
  ['platform_contact_reveals', 'actor_context_id'],
  ['platform_export_requests', 'requested_in_context_id'],
  ['platform_idempotency_keys', 'operating_context_id'],
  ['agent_assignments', 'authorizing_context_id']
]);

const SOURCE_COLUMNS = Object.freeze({
  operating_contexts: ['context_id', 'tenant_id', 'organization_id', 'context_type'],
  membership_operating_contexts: ['tenant_id', 'user_id', 'organization_id', 'context_id'],
  shipment_cases: ['id', 'tenant_id', 'x_org_id', 'y_org_id'],
  platform_contracts: ['id', 'tenant_id', 'x_org_id'],
  rfq_books: ['id', 'tenant_id', 'level', 'publisher_org_id'],
  rfq_quotes: ['id', 'tenant_id', 'rfq_id', 'bidder_org_id'],
  vehicles: ['id', 'tenant_id', 'owner_org_id'],
  carrier_driver_assignments: ['id', 'tenant_id', 'y_org_id'],
  driver_internal_bids: ['id', 'tenant_id', 'y_org_id'],
  trip_cases: ['id', 'tenant_id', 'x_org_id', 'y_org_id'],
  driver_trip_acceptances: ['id', 'tenant_id', 'trip_id'],
  driver_delivery_otps: ['id', 'tenant_id', 'trip_id'],
  platform_trip_events: ['id', 'tenant_id', 'trip_id', 'actor_user_id'],
  platform_documents: ['id', 'tenant_id', 'owner_org_id'],
  pod_cases: ['id', 'tenant_id', 'trip_id'],
  pod_evidence_versions: ['id', 'tenant_id', 'pod_id'],
  trip_loading_evidence: ['id', 'tenant_id', 'trip_id', 'owner_org_id'],
  trip_loading_schedules: ['id', 'tenant_id', 'trip_id', 'created_by_user_id'],
  relationship_ledgers: ['id', 'tenant_id', 'relationship_type', 'payer_org_id', 'payee_org_id'],
  platform_claims: ['id', 'tenant_id', 'opened_by_user_id', 'opened_by_org_id'],
  platform_exceptions: ['id', 'tenant_id', 'opened_by_user_id', 'opened_by_org_id'],
  platform_domain_events: ['id', 'tenant_id', 'actor_user_id'],
  platform_notifications: ['id', 'tenant_id', 'recipient_org_id', 'recipient_user_id'],
  platform_contact_reveals: ['id', 'tenant_id', 'actor_user_id', 'organization_id'],
  platform_export_requests: ['id', 'tenant_id', 'requested_by_user_id', 'organization_id'],
  platform_idempotency_keys: ['id', 'tenant_id', 'actor_user_id'],
  agent_assignments: ['id', 'tenant_id', 'trip_id', 'assigned_by_org_id']
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tableBlock(schema, table) {
  const pattern = new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? ${escapeRegex(table)} \\(([^]*?)\\) ENGINE=`, 'm');
  const match = schema.match(pattern);
  assert.ok(match, `base schema table is missing: ${table}`);
  return match[1];
}

function catalogPairs(source) {
  const valuesStart = source.indexOf('INSERT IGNORE INTO annex_m3_backfill_targets');
  const valuesEnd = source.indexOf(';', valuesStart);
  const values = source.slice(valuesStart, valuesEnd);
  return [...values.matchAll(/\('([a-z0-9_]+)', '([a-z0-9_]+)', '[A-Z_]+'/g)]
    .map((match) => `${match[1]}.${match[2]}`)
    .sort();
}

function targetPairsFromCalls(source, callName) {
  const pattern = new RegExp(`${callName}\\('([a-z0-9_]+)', '([a-z0-9_]+)'`, 'g');
  return [...source.matchAll(pattern)].map((match) => `${match[1]}.${match[2]}`).sort();
}

function columnPairsFromCalls(source) {
  return [...source.matchAll(/CALL annex_m3_exec_ddl\('COLUMN', '([a-z0-9_]+)', '([a-z0-9_]+)'/g)]
    .map((match) => `${match[1]}.${match[2]}`)
    .sort();
}

function ddlObjectPairs(source, kind) {
  const pattern = new RegExp(`CALL annex_m3_exec_ddl\\('${kind}', '([a-z0-9_]+)', '([a-z0-9_]+)'`, 'g');
  return [...source.matchAll(pattern)].map((match) => `${match[1]}.${match[2]}`).sort();
}

function cteObjectPairs(source, cteName, nextCteName) {
  const start = source.indexOf(`${cteName} AS (`);
  const end = source.indexOf(`),\n${nextCteName} AS (`, start);
  assert.notEqual(start, -1, `postcheck CTE is missing: ${cteName}`);
  assert.notEqual(end, -1, `postcheck CTE boundary is missing: ${nextCteName}`);
  return [...source.slice(start, end).matchAll(/(?:SELECT|UNION ALL SELECT) '([a-z0-9_]+)'(?: AS table_name)?, '([a-z0-9_]+)'/g)]
    .map((match) => `${match[1]}.${match[2]}`)
    .sort();
}

function removeSqlCommentsAndStrings(source) {
  return source
    .replace(/--[^\r\n]*/g, '')
    .replace(/'(?:''|[^'])*'/g, "''");
}

test('M3 target inventory is grounded in existing schema columns', async () => {
  const schema = (await Promise.all([
    fs.readFile(schemaPath, 'utf8'),
    fs.readFile(m1Path, 'utf8'),
    fs.readFile(m2Path, 'utf8')
  ])).join('\n');
  for (const [table, columns] of Object.entries(SOURCE_COLUMNS)) {
    const block = tableBlock(schema, table);
    for (const column of columns) {
      assert.match(block, new RegExp(`\\b${escapeRegex(column)}\\b`), `${table}.${column} must exist in the baseline schema`);
    }
  }
});

test('M3 catalog, nullable DDL, relations, postcheck and batch calls remain structurally aligned', async () => {
  const [source, postcheck] = await Promise.all([
    fs.readFile(applyPath, 'utf8'),
    fs.readFile(postcheckPath, 'utf8')
  ]);
  const expected = TARGETS.map(([table, column]) => `${table}.${column}`).sort();
  assert.equal(new Set(expected).size, 28);
  assert.deepEqual(catalogPairs(source), expected);
  assert.deepEqual(targetPairsFromCalls(source, 'CALL annex_m3_process_target'), expected);
  assert.deepEqual(columnPairsFromCalls(source), expected);
  assert.deepEqual(cteObjectPairs(postcheck, 'expected_columns', 'expected_indexes'), expected);

  const applyIndexes = ddlObjectPairs(source, 'INDEX');
  const applyConstraints = ddlObjectPairs(source, 'CONSTRAINT');
  assert.equal(new Set(applyIndexes).size, 29);
  assert.equal(new Set(applyConstraints).size, 29);
  assert.deepEqual(cteObjectPairs(postcheck, 'expected_indexes', 'expected_constraints'), applyIndexes);
  assert.deepEqual(cteObjectPairs(postcheck, 'expected_constraints', 'source_counts'), applyConstraints);

  for (const [table, column] of TARGETS) {
    assert.match(
      source,
      new RegExp(`ALTER TABLE ${escapeRegex(table)} ADD COLUMN ${escapeRegex(column)} VARCHAR\\(128\\) NULL`),
      `${table}.${column} must be introduced as nullable VARCHAR(128)`
    );
  }
  assert.doesNotMatch(source, /MODIFY\s+COLUMN\s+\w*context_id\s+[^;]*NOT\s+NULL/i);
});

test('M3 attribution is fail-safe and records resumable reconciliation evidence', async () => {
  const source = await fs.readFile(applyPath, 'utf8');
  assert.match(source, /CREATE TABLE IF NOT EXISTS annex_m3_backfill_checkpoints/);
  assert.match(source, /snapshot_max_id BIGINT UNSIGNED NOT NULL/);
  assert.match(source, /last_scanned_id BIGINT UNSIGNED NOT NULL/);
  assert.match(source, /artifact_revision VARCHAR\(64\) NOT NULL/);
  assert.match(source, /START TRANSACTION;[^]*COMMIT;/);
  assert.match(source, /DECLARE EXIT HANDLER FOR SQLEXCEPTION[^]*ROLLBACK;[^]*RESIGNAL;/);
  assert.match(source, /COUNT\(DISTINCT candidates\.candidate_context_id\) = 1[^]*THEN MIN\(candidates\.candidate_context_id\)/);
  assert.match(source, /COUNT\(DISTINCT candidates\.candidate_context_id\) = 0 THEN 'MISSING'/);
  assert.match(source, /ELSE 'AMBIGUOUS'/);
  assert.match(source, /COUNT\(DISTINCT candidates\.source_organization_id\) = 1[^]*THEN MIN\(candidates\.source_organization_id\)[^]*ELSE NULL/);
  assert.match(source, /target\.`', p_target_column, '` IS NULL/);
  assert.match(source, /HISTORICAL_EVENT_CONTEXT_NOT_RECORDED/);
  assert.match(source, /HISTORICAL_REQUEST_CONTEXT_NOT_RECORDED/);
  assert.doesNotMatch(source, /organization_type/i);
  assert.doesNotMatch(source, /audit_events/i);
  assert.doesNotMatch(source, /issuer_context_id/i);
  assert.doesNotMatch(source, /CTX-002|CTX-003/);
});

test('M3 preflight and postcheck are read-only and expose sizing and unresolved reports', async () => {
  const [preflight, postcheck] = await Promise.all([
    fs.readFile(preflightPath, 'utf8'),
    fs.readFile(postcheckPath, 'utf8')
  ]);
  const mutatingSql = /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|TRUNCATE|CALL|SET|PREPARE|EXECUTE)\b/i;
  assert.doesNotMatch(removeSqlCommentsAndStrings(preflight), mutatingSql);
  assert.doesNotMatch(removeSqlCommentsAndStrings(postcheck), mutatingSql);
  const sizing = preflight.slice(preflight.indexOf('-- Read-only sizing output.'));
  const sizingTargets = [...sizing.matchAll(/(?:SELECT|UNION ALL SELECT) '([a-z0-9_]+)'(?: AS target_table)?, '([a-z0-9_]+)'/g)]
    .map((match) => `${match[1]}.${match[2]}`)
    .sort();
  assert.deepEqual(sizingTargets, TARGETS.map(([table, column]) => `${table}.${column}`).sort());
  assert.match(postcheck, /M3_SOURCE_ROWS_UNACCOUNTED/);
  assert.match(postcheck, /M3_CHECKPOINT_COUNTER_MISMATCH/);
  assert.match(postcheck, /WHERE a\.disposition IN \('MISSING', 'AMBIGUOUS'\)/);
  assert.match(postcheck, /Full review queue/);
  assert.doesNotMatch(`${preflight}\n${postcheck}`, /CTX-002|CTX-003/);
});

test('M3 is checksum-pinned PREPARED while M4 remains RESERVED', async () => {
  const m3 = ANNEX_MIGRATION_MANIFEST.migrations.find((item) => item.id === 'M3');
  const m4 = ANNEX_MIGRATION_MANIFEST.migrations.find((item) => item.id === 'M4');
  assert.equal(m3.status, 'PREPARED');
  assert.equal(m3.preflightScript, 'sql/M3.preflight.sql');
  assert.equal(m3.script, 'sql/M3.sql');
  assert.equal(m3.postcheckScript, 'sql/M3.postcheck.sql');
  assert.match(m3.preflightChecksum, /^[a-f0-9]{64}$/);
  assert.match(m3.checksum, /^[a-f0-9]{64}$/);
  assert.match(m3.postcheckChecksum, /^[a-f0-9]{64}$/);
  assert.equal(m4.status, 'RESERVED');
  assert.equal(m4.script, null);

  const plan = createAnnexMigrationDryRun({ target: 'M3' });
  const checks = await verifyReadyMigrationSources(plan);
  assert.equal(plan.executable, false);
  assert.deepEqual(plan.migrations.map((item) => item.id), ['M1', 'M2', 'M3']);
  assert.deepEqual(checks.map((item) => [item.id, item.status, item.verified]), [
    ['M1', 'PREPARED', true],
    ['M2', 'PREPARED', true],
    ['M3', 'PREPARED', true]
  ]);
});

test('M3 CLI dry-run verifies artifacts without database configuration or execution', async () => {
  const { stdout, stderr } = await executeFile(
    process.execPath,
    ['src/migrations/annex/cli.js', '--dry-run', '--target=M3', '--json'],
    {
      cwd: serverRoot,
      env: { ...process.env, DB_HOST: '', DB_USER: '', DB_PASSWORD: '', DB_NAME: '' }
    }
  );
  assert.equal(stderr, '');
  const result = JSON.parse(stdout);
  assert.equal(result.mode, 'DRY_RUN');
  assert.equal(result.target, 'M3');
  assert.equal(result.executable, false);
  assert.deepEqual(result.sourceChecks.map((item) => [item.id, item.status, item.verified]), [
    ['M1', 'PREPARED', true],
    ['M2', 'PREPARED', true],
    ['M3', 'PREPARED', true]
  ]);
});
