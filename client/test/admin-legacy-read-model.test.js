import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('admin governance panel exposes the legacy registration read model', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/components/AdminGovernancePanel.jsx', import.meta.url)), 'utf8');
  assert.match(source, /\/api\/platform\/admin\/legacy-registrations\?limit=100/);
  assert.match(source, /\['legacyRegistrations', 'ثبت‌نام‌های قبلی'\]/);
  assert.match(source, /legacy\.recent/);
  assert.match(source, /accounts\.drivers/);
  assert.match(source, /accounts\.carriers/);
});
