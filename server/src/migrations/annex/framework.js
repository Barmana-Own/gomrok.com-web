import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANNEX_MIGRATION_MANIFEST, ANNEX_MIGRATION_SEQUENCE } from './manifest.js';

const READY_CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const MIGRATION_STATUSES = new Set(['RESERVED', 'PREPARED', 'READY']);
const migrationRoot = fileURLToPath(new URL('./', import.meta.url));

export class AnnexMigrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AnnexMigrationError';
    this.code = code;
    this.details = details;
  }
}

function fail(message, details = {}) {
  throw new AnnexMigrationError('MIGRATION_MANIFEST_INVALID', message, details);
}

function assertJsonValue(value, location, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('Manifest contains a non-finite number.', { location });
    return;
  }
  if (typeof value !== 'object') fail('Manifest contains a non-JSON value.', { location });
  if (seen.has(value)) fail('Manifest contains a circular value.', { location });
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${location}[${index}]`, seen));
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      fail('Manifest objects must be plain JSON objects.', { location });
    }
    for (const [key, item] of Object.entries(value)) assertJsonValue(item, `${location}.${key}`, seen);
  }
  seen.delete(value);
}

export function stableJson(value) {
  assertJsonValue(value, '$');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function manifestChecksum(manifest = ANNEX_MIGRATION_MANIFEST) {
  return sha256(stableJson(manifest));
}

function validateScriptPath(script, migrationId) {
  if (typeof script !== 'string' || !script.length || script.includes('\\')) {
    fail('Artifact-bearing migration must use a non-empty POSIX relative script path.', { migrationId });
  }
  const normalized = path.posix.normalize(script);
  if (path.posix.isAbsolute(script) || normalized !== script || normalized === '..' || normalized.startsWith('../')) {
    fail('Migration script path must remain inside the annex migration directory.', { migrationId });
  }
  return script;
}

export function validateAnnexMigrationManifest(manifest = ANNEX_MIGRATION_MANIFEST) {
  assertJsonValue(manifest, '$');
  if (!Number.isSafeInteger(manifest.schemaVersion) || manifest.schemaVersion < 1) {
    fail('Manifest schemaVersion must be a positive integer.');
  }
  if (typeof manifest.series !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(manifest.series)) {
    fail('Manifest series is invalid.');
  }
  if (!Array.isArray(manifest.migrations) || manifest.migrations.length !== ANNEX_MIGRATION_SEQUENCE.length) {
    fail('Manifest must reserve exactly the M1 through M8 migration slots.');
  }

  const ids = new Set();
  manifest.migrations.forEach((item, index) => {
    const expectedId = ANNEX_MIGRATION_SEQUENCE[index];
    const expectedDependency = index === 0 ? [] : [ANNEX_MIGRATION_SEQUENCE[index - 1]];
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('Migration entry must be an object.', { index });
    if (item.id !== expectedId || item.order !== index + 1) {
      fail('Migration entries must remain in deterministic M1 through M8 order.', { index, expectedId });
    }
    if (ids.has(item.id)) fail('Migration identifiers must be unique.', { migrationId: item.id });
    ids.add(item.id);
    if (typeof item.packageId !== 'string' || !/^P\d{2}$/.test(item.packageId)) {
      fail('Migration package identifier is invalid.', { migrationId: item.id });
    }
    if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 160) {
      fail('Migration title is invalid.', { migrationId: item.id });
    }
    if (!Array.isArray(item.dependsOn) || stableJson(item.dependsOn) !== stableJson(expectedDependency)) {
      fail('Migration dependency must point to the immediately preceding migration.', { migrationId: item.id });
    }
    if (!MIGRATION_STATUSES.has(item.status)) {
      fail('Migration status must be RESERVED, PREPARED, or READY.', { migrationId: item.id });
    }
    if (item.status === 'RESERVED') {
      if (
        item.preflightScript !== null ||
        item.preflightChecksum !== null ||
        item.script !== null ||
        item.checksum !== null ||
        item.postcheckScript !== null ||
        item.postcheckChecksum !== null
      ) {
        fail('RESERVED migrations cannot reference executable artifacts.', { migrationId: item.id });
      }
      return;
    }
    validateScriptPath(item.preflightScript, item.id);
    if (typeof item.preflightChecksum !== 'string' || !READY_CHECKSUM_PATTERN.test(item.preflightChecksum)) {
      fail('Migration preflight checksum must be a lowercase SHA-256 digest.', { migrationId: item.id });
    }
    validateScriptPath(item.script, item.id);
    if (typeof item.checksum !== 'string' || !READY_CHECKSUM_PATTERN.test(item.checksum)) {
      fail('Migration checksum must be a lowercase SHA-256 digest.', { migrationId: item.id });
    }
    validateScriptPath(item.postcheckScript, item.id);
    if (typeof item.postcheckChecksum !== 'string' || !READY_CHECKSUM_PATTERN.test(item.postcheckChecksum)) {
      fail('Migration postcheck checksum must be a lowercase SHA-256 digest.', { migrationId: item.id });
    }
  });
  return manifest;
}

function normalizeTarget(target) {
  const value = String(target === undefined ? ANNEX_MIGRATION_SEQUENCE.at(-1) : target).trim().toUpperCase();
  if (!ANNEX_MIGRATION_SEQUENCE.includes(value)) {
    throw new AnnexMigrationError('MIGRATION_TARGET_INVALID', 'Migration target must be one of M1 through M8.');
  }
  return value;
}

export function createAnnexMigrationDryRun({ manifest = ANNEX_MIGRATION_MANIFEST, target } = {}) {
  validateAnnexMigrationManifest(manifest);
  const normalizedTarget = normalizeTarget(target);
  const targetIndex = ANNEX_MIGRATION_SEQUENCE.indexOf(normalizedTarget);
  const migrations = manifest.migrations.slice(0, targetIndex + 1).map((item) => ({
    id: item.id,
    order: item.order,
    packageId: item.packageId,
    title: item.title,
    dependsOn: [...item.dependsOn],
    status: item.status,
    preflightScript: item.preflightScript,
    preflightChecksum: item.preflightChecksum,
    script: item.script,
    checksum: item.checksum,
    postcheckScript: item.postcheckScript,
    postcheckChecksum: item.postcheckChecksum,
    descriptorChecksum: sha256(stableJson(item))
  }));
  return {
    mode: 'DRY_RUN',
    schemaVersion: manifest.schemaVersion,
    series: manifest.series,
    target: normalizedTarget,
    manifestChecksum: manifestChecksum(manifest),
    executable: migrations.every((item) => item.status === 'READY'),
    migrations
  };
}

export async function verifyReadyMigrationSources(plan, { readFile = fs.readFile, root = migrationRoot } = {}) {
  if (!plan || plan.mode !== 'DRY_RUN' || !Array.isArray(plan.migrations)) {
    throw new AnnexMigrationError('MIGRATION_PLAN_INVALID', 'A validated dry-run plan is required.');
  }
  const checks = [];
  for (const item of plan.migrations) {
    if (item.status === 'RESERVED') {
      checks.push({ id: item.id, status: 'RESERVED', verified: false });
      continue;
    }
    validateScriptPath(item.preflightScript, item.id);
    validateScriptPath(item.script, item.id);
    validateScriptPath(item.postcheckScript, item.id);
    const absoluteRoot = path.resolve(root);
    const sources = [
      { kind: 'preflight', script: item.preflightScript, checksum: item.preflightChecksum },
      { kind: 'apply', script: item.script, checksum: item.checksum },
      { kind: 'postcheck', script: item.postcheckScript, checksum: item.postcheckChecksum }
    ];
    const verifiedSources = {};
    for (const sourceItem of sources) {
      const absoluteScript = path.resolve(absoluteRoot, ...sourceItem.script.split('/'));
      if (absoluteScript !== absoluteRoot && !absoluteScript.startsWith(`${absoluteRoot}${path.sep}`)) {
        fail('Resolved migration path escaped the annex migration directory.', { migrationId: item.id, kind: sourceItem.kind });
      }
      const source = await readFile(absoluteScript);
      const actualChecksum = sha256(source);
      if (actualChecksum !== sourceItem.checksum) {
        throw new AnnexMigrationError('MIGRATION_CHECKSUM_MISMATCH', 'Migration source checksum does not match the manifest.', { migrationId: item.id, kind: sourceItem.kind });
      }
      verifiedSources[`${sourceItem.kind}Checksum`] = actualChecksum;
    }
    checks.push({ id: item.id, status: item.status, verified: true, ...verifiedSources });
  }
  return checks;
}

export function assertAnnexPlanExecutable(plan) {
  const pending = plan?.migrations?.filter((item) => item.status !== 'READY').map((item) => item.id) || [];
  if (!plan?.executable || pending.length) {
    throw new AnnexMigrationError(
      'MIGRATION_EXECUTION_BLOCKED',
      'Annex migration execution is blocked until every selected slot has a reviewed immutable artifact.',
      { pending }
    );
  }
  return true;
}

export function parseAnnexMigrationCliArgs(argv = []) {
  let dryRun = false;
  let json = false;
  let target = ANNEX_MIGRATION_SEQUENCE.at(-1);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') dryRun = true;
    else if (argument === '--json') json = true;
    else if (argument === '--target') {
      if (index + 1 >= argv.length) {
        throw new AnnexMigrationError('MIGRATION_TARGET_INVALID', 'The --target option requires one of M1 through M8.');
      }
      target = argv[++index];
    }
    else if (argument.startsWith('--target=')) target = argument.slice('--target='.length);
    else {
      throw new AnnexMigrationError('MIGRATION_ARGUMENT_INVALID', 'Only --dry-run, --json, and --target M1..M8 are supported.');
    }
  }
  if (!dryRun) {
    throw new AnnexMigrationError('MIGRATION_EXECUTION_BLOCKED', 'This preparation command is dry-run only and cannot execute migrations.');
  }
  return { dryRun: true, json, target: normalizeTarget(target) };
}
