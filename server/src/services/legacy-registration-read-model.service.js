const SUMMARY_STATUSES = Object.freeze(['pending', 'active', 'rejected', 'disabled']);

function maskLegacyValue(value, visible = 2) {
  const text = String(value || '');
  if (!text) return null;
  if (text.length <= visible) return '*'.repeat(text.length);
  return `${text.slice(0, visible)}${'*'.repeat(Math.min(Math.max(text.length - visible, 3), 8))}`;
}

function emptyStatusSummary() {
  return { total: 0, pending: 0, active: 0, rejected: 0, disabled: 0 };
}

function summarizeStatusRows(rows = []) {
  const summary = emptyStatusSummary();
  for (const row of rows) {
    const status = String(row.status || '').trim().toLowerCase();
    const total = Number(row.total || 0);
    summary.total += total;
    if (SUMMARY_STATUSES.includes(status)) summary[status] += total;
  }
  return summary;
}

function publicLegacyRegistration(row) {
  const role = String(row.role || '').toLowerCase();
  const isDriver = role === 'driver';
  const displayName = isDriver
    ? [row.first_name, row.last_name].filter(Boolean).join(' ')
    : String(row.business_name || '').trim();

  return {
    id: Number(row.id),
    role,
    displayName: displayName || 'ثبت نشده',
    firstName: row.first_name || null,
    lastName: row.last_name || null,
    businessName: row.business_name || null,
    phone: maskLegacyValue(row.phone, 3),
    identity: maskLegacyValue(isDriver ? row.national_id : row.national_identifier, 2),
    registrationNumber: maskLegacyValue(row.registration_number, 2),
    status: String(row.status || '').toLowerCase(),
    accountId: row.account_id === null || row.account_id === undefined ? null : Number(row.account_id),
    accountCreated: row.account_id !== null && row.account_id !== undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: 'legacy-registration-read-model'
  };
}

function groupedSummary(rows, role) {
  return summarizeStatusRows(rows.filter((row) => String(row.role || '').toLowerCase() === role));
}

async function readLegacyRegistrationReadModel(db, tenantId, limit = 100) {
  const scopedTenantId = String(tenantId || '').trim();
  if (!scopedTenantId) throw new TypeError('tenantId is required for the legacy registration read model.');
  const boundedLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);

  const [accountStatusRows, requestStatusRows, recentRows] = await Promise.all([
    db.execute(
      `SELECT 'driver' AS role, status, COUNT(*) AS total
         FROM drivers
        WHERE tenant_id = ?
        GROUP BY status
       UNION ALL
       SELECT 'carrier' AS role, status, COUNT(*) AS total
         FROM carriers
        WHERE tenant_id = ?
        GROUP BY status`,
      [scopedTenantId, scopedTenantId]
    ),
    db.execute(
      `SELECT role, status, COUNT(*) AS total
         FROM registration_requests
        WHERE tenant_id = ? AND role IN ('driver', 'carrier')
        GROUP BY role, status`,
      [scopedTenantId]
    ),
    db.execute(
      `SELECT id, role, first_name, last_name, business_name, phone,
              national_id, registration_number, national_identifier,
              status, account_id, created_at, updated_at
         FROM registration_requests
        WHERE tenant_id = ? AND role IN ('driver', 'carrier')
        ORDER BY created_at DESC, id DESC
        LIMIT ${boundedLimit}`,
      [scopedTenantId]
    )
  ]);

  const accountRows = accountStatusRows[0];
  const requestRows = requestStatusRows[0];
  return {
    accounts: {
      drivers: groupedSummary(accountRows, 'driver'),
      carriers: groupedSummary(accountRows, 'carrier')
    },
    requests: {
      drivers: groupedSummary(requestRows, 'driver'),
      carriers: groupedSummary(requestRows, 'carrier')
    },
    recent: recentRows[0].map(publicLegacyRegistration)
  };
}

export {
  emptyStatusSummary,
  maskLegacyValue,
  publicLegacyRegistration,
  readLegacyRegistrationReadModel,
  summarizeStatusRows
};
