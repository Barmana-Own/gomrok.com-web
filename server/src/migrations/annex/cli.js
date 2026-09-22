import { createAnnexMigrationDryRun, parseAnnexMigrationCliArgs, verifyReadyMigrationSources } from './framework.js';

async function main() {
  const options = parseAnnexMigrationCliArgs(process.argv.slice(2));
  const plan = createAnnexMigrationDryRun({ target: options.target });
  const sourceChecks = await verifyReadyMigrationSources(plan);
  const output = { ...plan, sourceChecks };
  process.stdout.write(`${JSON.stringify(output, null, options.json ? 2 : 0)}\n`);
}

main().catch((error) => {
  const code = typeof error?.code === 'string' ? error.code : 'MIGRATION_PRECHECK_FAILED';
  const message = typeof error?.message === 'string' ? error.message : 'Annex migration precheck failed.';
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 1;
});
