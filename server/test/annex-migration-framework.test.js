import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  AnnexMigrationError,
  assertAnnexPlanExecutable,
  createAnnexMigrationDryRun,
  manifestChecksum,
  parseAnnexMigrationCliArgs,
  sha256,
  stableJson,
  validateAnnexMigrationManifest,
  verifyReadyMigrationSources
} from '../src/migrations/annex/framework.js';
import { ANNEX_MIGRATION_MANIFEST, ANNEX_MIGRATION_SEQUENCE } from '../src/migrations/annex/manifest.js';

const executeFile = promisify(execFile);
const serverRoot = fileURLToPath(new URL('../', import.meta.url));

function mutableManifest() {
  return JSON.parse(JSON.stringify(ANNEX_MIGRATION_MANIFEST));
}

test('annex manifest reserves an exact deterministic M1 through M8 chain', () => {
  assert.equal(validateAnnexMigrationManifest(ANNEX_MIGRATION_MANIFEST), ANNEX_MIGRATION_MANIFEST);
  assert.equal(ANNEX_MIGRATION_MANIFEST.schemaVersion, 2);
  assert.deepEqual(ANNEX_MIGRATION_MANIFEST.migrations.map((item) => item.id), ANNEX_MIGRATION_SEQUENCE);
  assert.deepEqual(ANNEX_MIGRATION_MANIFEST.migrations.map((item) => item.order), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(ANNEX_MIGRATION_MANIFEST.migrations.map((item) => item.title), [
    'Operating contexts and initial role-derived boundaries',
    'Role grants, context linkage, membership, and sessions',
    'Nullable transactional context and controlled backfill',
    'Required context and fail-closed query boundaries',
    'Document issuer authority foundation',
    'Consignment and allocation hierarchy',
    'Global active-vehicle reservation integrity',
    'Inter-context financial separation'
  ]);
  assert.equal(ANNEX_MIGRATION_MANIFEST.migrations[0].status, 'PREPARED');
  assert.equal(ANNEX_MIGRATION_MANIFEST.migrations[1].status, 'PREPARED');
  assert.equal(ANNEX_MIGRATION_MANIFEST.migrations[2].status, 'PREPARED');
  assert.equal(ANNEX_MIGRATION_MANIFEST.migrations.slice(3).every((item) => item.status === 'RESERVED'), true);
});

test('manifest checksum is deterministic across object key insertion order', () => {
  const reordered = {
    migrations: ANNEX_MIGRATION_MANIFEST.migrations.map((item) => ({
      postcheckChecksum: item.postcheckChecksum,
      postcheckScript: item.postcheckScript,
      checksum: item.checksum,
      script: item.script,
      preflightChecksum: item.preflightChecksum,
      preflightScript: item.preflightScript,
      status: item.status,
      dependsOn: [...item.dependsOn],
      title: item.title,
      packageId: item.packageId,
      order: item.order,
      id: item.id
    })),
    series: ANNEX_MIGRATION_MANIFEST.series,
    schemaVersion: ANNEX_MIGRATION_MANIFEST.schemaVersion
  };
  assert.equal(stableJson(reordered), stableJson(ANNEX_MIGRATION_MANIFEST));
  assert.equal(manifestChecksum(reordered), manifestChecksum(ANNEX_MIGRATION_MANIFEST));
});

test('manifest preflight rejects reordering, dependency drift, and executable path traversal', () => {
  const reordered = mutableManifest();
  [reordered.migrations[0], reordered.migrations[1]] = [reordered.migrations[1], reordered.migrations[0]];
  assert.throws(() => validateAnnexMigrationManifest(reordered), (error) => error instanceof AnnexMigrationError && error.code === 'MIGRATION_MANIFEST_INVALID');

  const dependencyDrift = mutableManifest();
  dependencyDrift.migrations[3].dependsOn = ['M1'];
  assert.throws(() => validateAnnexMigrationManifest(dependencyDrift), (error) => error.code === 'MIGRATION_MANIFEST_INVALID');

  const traversal = mutableManifest();
  traversal.migrations[0] = {
    ...traversal.migrations[0],
    status: 'READY',
    preflightScript: 'sql/M1.preflight.sql',
    preflightChecksum: sha256('SELECT 1;'),
    script: '../outside.sql',
    checksum: sha256('SELECT 1;')
  };
  assert.throws(() => validateAnnexMigrationManifest(traversal), (error) => error.code === 'MIGRATION_MANIFEST_INVALID');
});

test('dry-run target includes the complete ordered dependency closure', () => {
  const plan = createAnnexMigrationDryRun({ target: 'm5' });
  assert.equal(plan.mode, 'DRY_RUN');
  assert.equal(plan.target, 'M5');
  assert.equal(plan.executable, false);
  assert.deepEqual(plan.migrations.map((item) => item.id), ['M1', 'M2', 'M3', 'M4', 'M5']);
  assert.match(plan.manifestChecksum, /^[a-f0-9]{64}$/);
  assert.equal(plan.migrations.every((item) => /^[a-f0-9]{64}$/.test(item.descriptorChecksum)), true);
});

test('source verification skips reserved slots and never reads a migration file', async () => {
  let reads = 0;
  const manifest = mutableManifest();
  manifest.migrations[0] = {
    ...manifest.migrations[0],
    status: 'RESERVED',
    preflightScript: null,
    preflightChecksum: null,
    script: null,
    checksum: null,
    postcheckScript: null,
    postcheckChecksum: null
  };
  manifest.migrations[1] = {
    ...manifest.migrations[1],
    status: 'RESERVED',
    preflightScript: null,
    preflightChecksum: null,
    script: null,
    checksum: null,
    postcheckScript: null,
    postcheckChecksum: null
  };
  manifest.migrations[2] = {
    ...manifest.migrations[2],
    status: 'RESERVED',
    preflightScript: null,
    preflightChecksum: null,
    script: null,
    checksum: null,
    postcheckScript: null,
    postcheckChecksum: null
  };
  const plan = createAnnexMigrationDryRun({ manifest, target: 'M3' });
  const checks = await verifyReadyMigrationSources(plan, { readFile: async () => { reads += 1; return Buffer.from(''); } });
  assert.equal(reads, 0);
  assert.deepEqual(checks, [
    { id: 'M1', status: 'RESERVED', verified: false },
    { id: 'M2', status: 'RESERVED', verified: false },
    { id: 'M3', status: 'RESERVED', verified: false }
  ]);
});

test('PREPARED and READY source verification accepts an exact checksum and rejects drift', async () => {
  const source = Buffer.from('SELECT 1;\n');
  const manifest = mutableManifest();
  manifest.migrations[0] = {
    ...manifest.migrations[0],
    status: 'PREPARED',
    preflightScript: 'sql/M1.preflight.sql',
    preflightChecksum: sha256(source),
    script: 'sql/M1.sql',
    checksum: sha256(source),
    postcheckScript: 'sql/M1.postcheck.sql',
    postcheckChecksum: sha256(source)
  };
  const plan = createAnnexMigrationDryRun({ manifest, target: 'M1' });
  const checks = await verifyReadyMigrationSources(plan, { readFile: async () => source });
  assert.equal(checks[0].verified, true);
  assert.equal(checks[0].status, 'PREPARED');
  assert.equal(checks[0].preflightChecksum, sha256(source));
  assert.equal(checks[0].applyChecksum, sha256(source));
  assert.equal(checks[0].postcheckChecksum, sha256(source));
  await assert.rejects(
    () => verifyReadyMigrationSources(plan, { readFile: async () => Buffer.from('SELECT 2;\n') }),
    (error) => error.code === 'MIGRATION_CHECKSUM_MISMATCH' && error.details.migrationId === 'M1'
  );
});

test('prepared or reserved plans are explicitly blocked from execution', () => {
  const plan = createAnnexMigrationDryRun({ target: 'M2' });
  assert.throws(
    () => assertAnnexPlanExecutable(plan),
    (error) => error.code === 'MIGRATION_EXECUTION_BLOCKED' && error.details.pending.join(',') === 'M1,M2'
  );
});

test('preparation CLI accepts only dry-run targets and rejects execution-shaped arguments', () => {
  assert.deepEqual(parseAnnexMigrationCliArgs(['--dry-run', '--target=m4', '--json']), { dryRun: true, json: true, target: 'M4' });
  assert.throws(() => parseAnnexMigrationCliArgs(['--target=M1']), (error) => error.code === 'MIGRATION_EXECUTION_BLOCKED');
  assert.throws(() => parseAnnexMigrationCliArgs(['--dry-run', '--execute']), (error) => error.code === 'MIGRATION_ARGUMENT_INVALID');
  assert.throws(() => parseAnnexMigrationCliArgs(['--dry-run', '--target=M9']), (error) => error.code === 'MIGRATION_TARGET_INVALID');
  assert.throws(() => parseAnnexMigrationCliArgs(['--dry-run', '--target']), (error) => error.code === 'MIGRATION_TARGET_INVALID');
  assert.throws(() => parseAnnexMigrationCliArgs(['--dry-run', '--target=']), (error) => error.code === 'MIGRATION_TARGET_INVALID');
});

test('CLI dry-run completes without database configuration or migration execution', async () => {
  const { stdout, stderr } = await executeFile(process.execPath, ['src/migrations/annex/cli.js', '--dry-run', '--target=M2', '--json'], {
    cwd: serverRoot,
    env: { ...process.env, DB_HOST: '', DB_USER: '', DB_PASSWORD: '', DB_NAME: '' }
  });
  assert.equal(stderr, '');
  const result = JSON.parse(stdout);
  assert.equal(result.mode, 'DRY_RUN');
  assert.equal(result.target, 'M2');
  assert.equal(result.executable, false);
  assert.deepEqual(result.migrations.map((item) => item.id), ['M1', 'M2']);
  assert.equal(result.sourceChecks[0].status, 'PREPARED');
  assert.equal(result.sourceChecks[0].verified, true);
  assert.equal(result.sourceChecks[1].status, 'PREPARED');
  assert.equal(result.sourceChecks[1].verified, true);
});
