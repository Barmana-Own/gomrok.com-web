import test from 'node:test';
import assert from 'node:assert/strict';
import {
  publicLegacyRegistration,
  readLegacyRegistrationReadModel,
  summarizeStatusRows
} from '../src/services/legacy-registration-read-model.service.js';

test('legacy registration summaries preserve role and status totals', () => {
  assert.deepEqual(
    summarizeStatusRows([
      { status: 'pending', total: 2 },
      { status: 'ACTIVE', total: 3 },
      { status: 'unknown', total: 4 }
    ]),
    { total: 9, pending: 2, active: 3, rejected: 0, disabled: 0 }
  );
});

test('legacy registration projection masks direct identifiers', () => {
  const result = publicLegacyRegistration({
    id: 7,
    role: 'driver',
    first_name: 'آزمایشی',
    last_name: 'راننده',
    national_id: '1234567890',
    phone: '09121234567',
    status: 'pending',
    account_id: null,
    created_at: '2026-09-14T00:00:00.000Z'
  });

  assert.equal(result.displayName, 'آزمایشی راننده');
  assert.equal(result.phone, '091********');
  assert.equal(result.identity, '12********');
  assert.equal(result.accountCreated, false);
});

test('legacy read model scopes every query to the requested tenant and caps the list', async () => {
  const calls = [];
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM drivers')) return [[{ role: 'driver', status: 'active', total: 1 }, { role: 'carrier', status: 'active', total: 1 }]];
      if (sql.includes('GROUP BY role, status')) return [[{ role: 'driver', status: 'pending', total: 2 }]];
      return [[{ id: 1, role: 'driver', first_name: 'Test', last_name: 'Driver', phone: '09120000000', national_id: '1234567890', status: 'pending', account_id: null }]];
    }
  };

  const result = await readLegacyRegistrationReadModel(db, 'platform', 999);

  assert.equal(result.accounts.drivers.active, 1);
  assert.equal(result.requests.drivers.pending, 2);
  assert.equal(result.recent.length, 1);
  assert.equal(calls.length, 3);
  for (const call of calls) assert.equal(call.params[0], 'platform');
  assert.match(calls.find((call) => call.sql.includes('ORDER BY')).sql, /LIMIT 200/);
});
