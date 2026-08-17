import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import 'dotenv/config';
import { pingDatabase, pool } from './db.js';

const app = express();
const port = Number(process.env.PORT || 4000);
const jwtSecret = process.env.JWT_SECRET || 'development-only-change-me';
const adminUsername = process.env.ADMIN_USERNAME || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'GomrokAdmin#2026';

const configuredOrigins = String(process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://gomrok.org',
  'https://gomrok.org',
  'http://www.gomrok.org',
  'https://www.gomrok.org',
  ...configuredOrigins
]);

// Keep the API usable from the local development host and from the deployed
// same-origin app. Handling preflight explicitly is important here because
// the production frontend is served behind IIS and sends JSON requests.
app.use((request, response, next) => {
  const origin = String(request.headers.origin || '').trim();

  if (origin && !allowedOrigins.has(origin)) {
    if (request.method === 'OPTIONS') {
      return response.status(403).json({ message: 'مبدأ درخواست مجاز نیست.' });
    }
    return next();
  }

  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Vary', 'Origin');
  }

  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return response.status(204).end();
  }

  return next();
});
app.use(express.json({ limit: '64kb' }));

function normalizeDigits(value = '') {
  return String(value)
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632));
}

function digits(value = '') {
  return normalizeDigits(value).replace(/\D/g, '');
}

function issueToken(account, role = 'driver') {
  return jwt.sign({ sub: String(account.id), role, tenantId: account.tenant_id }, jwtSecret, { expiresIn: '8h' });
}

function issueAdminToken() {
  return jwt.sign({ sub: 'super-admin', role: 'super_admin' }, jwtSecret, { expiresIn: '4h' });
}

function requireAdmin(request, response, next) {
  const authorization = String(request.headers.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return response.status(401).json({ message: 'ورود مدیر سیستم لازم است.' });

  try {
    const claims = jwt.verify(token, jwtSecret);
    if (claims.role !== 'super_admin') return response.status(403).json({ message: 'دسترسی پنل مدیریت مجاز نیست.' });
    request.admin = claims;
    return next();
  } catch (_error) {
    return response.status(401).json({ message: 'نشست پنل مدیریت منقضی یا نامعتبر است.' });
  }
}

function publicDriver(driver) {
  return {
    id: driver.id,
    firstName: driver.first_name,
    lastName: driver.last_name,
    nationalId: driver.national_id,
    phone: driver.phone,
    province: driver.province,
    city: driver.city,
    status: driver.status,
    role: 'driver'
  };
}

function publicCarrier(carrier) {
  return {
    id: carrier.id,
    businessName: carrier.business_name,
    registrationNumber: carrier.registration_number || null,
    nationalIdentifier: carrier.identity_number,
    managerName: [carrier.manager_first_name, carrier.manager_last_name].filter(Boolean).join(' '),
    phone: carrier.phone,
    province: carrier.province,
    city: carrier.city,
    status: carrier.status,
    role: 'carrier'
  };
}

function publicRegistration(row) {
  const isDriver = row.role === 'driver';
  return {
    id: row.id,
    role: row.role,
    firstName: row.first_name,
    lastName: row.last_name,
    nationalId: row.national_id,
    businessName: row.business_name,
    registrationNumber: row.registration_number,
    nationalIdentifier: row.national_identifier,
    managerName: row.manager_name,
    phone: row.phone,
    province: row.province,
    status: row.status,
    accountId: row.account_id,
    accountCreated: Boolean(row.account_id),
    accountCreatedAt: row.account_created_at,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: 'registration',
    label: isDriver ? 'راننده' : 'کرییر'
  };
}

function registrationRole(role) {
  if (role === 'driver' || role === 'drivers') return 'driver';
  if (role === 'carrier' || role === 'carriers') return 'carrier';
  return null;
}

function roleConfig(role) {
  return role === 'driver'
    ? { table: 'drivers', label: 'راننده', plural: 'راننده‌ها' }
    : { table: 'carriers', label: 'کرییر', plural: 'کرییرها' };
}

function cleanManagerName(payload) {
  const direct = String(payload.managerName || '').trim();
  if (direct) return direct;
  return [payload.managerFirstName, payload.managerLastName]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

function driverPayload(payload) {
  return {
    firstName: String(payload.firstName || '').trim(),
    lastName: String(payload.lastName || '').trim(),
    nationalId: digits(payload.nationalId),
    phone: normalizeDigits(payload.phone).replace(/\s/g, ''),
    province: String(payload.province || '').trim()
  };
}

function carrierPayload(payload) {
  return {
    businessName: String(payload.businessName || '').trim(),
    registrationNumber: digits(payload.registrationNumber),
    nationalIdentifier: digits(payload.nationalIdentifier || payload.identityNumber),
    managerName: cleanManagerName(payload),
    phone: normalizeDigits(payload.phone).replace(/\s/g, ''),
    province: String(payload.province || '').trim()
  };
}

function validateDriver(payload) {
  if (!payload.firstName || !payload.lastName || !/^\d{10}$/.test(payload.nationalId) || !/^09\d{9}$/.test(payload.phone) || !payload.province) {
    return 'اطلاعات راننده کامل یا معتبر نیست.';
  }
  return '';
}

function validateCarrier(payload) {
  if (
    payload.businessName.length < 2 ||
    !/^\d{1,32}$/.test(payload.registrationNumber) ||
    !/^\d{11}$/.test(payload.nationalIdentifier) ||
    payload.managerName.length < 2 ||
    !/^09\d{9}$/.test(payload.phone) ||
    !payload.province
  ) {
    return 'اطلاعات کرییر کامل یا معتبر نیست.';
  }
  return '';
}

async function writeAudit({ actorId, eventType, subjectType = 'driver', subjectId, payload = {} }) {
  await pool.execute(
    `INSERT INTO audit_events (actor_id, event_type, subject_type, subject_id, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
    [actorId || null, eventType, subjectType, subjectId || null, JSON.stringify(payload)]
  );
}

async function createDriverRegistration(payload, response) {
  const input = driverPayload(payload);
  const validationMessage = validateDriver(input);
  if (validationMessage) return response.status(400).json({ message: validationMessage });

  try {
    const [existingAccount] = await pool.execute(
      'SELECT id FROM drivers WHERE national_id = ? OR phone = ? LIMIT 1',
      [input.nationalId, input.phone]
    );
    const [existingRequest] = await pool.execute(
      `SELECT id FROM registration_requests
       WHERE role = 'driver' AND status <> 'rejected'
         AND (national_id = ? OR phone = ?) LIMIT 1`,
      [input.nationalId, input.phone]
    );
    if (existingAccount.length || existingRequest.length) {
      return response.status(409).json({ message: 'این کد ملی یا شماره تماس قبلاً ثبت شده است.' });
    }

    const [result] = await pool.execute(
      `INSERT INTO registration_requests
       (tenant_id, role, first_name, last_name, national_id, phone, province, status)
       VALUES ('platform', 'driver', ?, ?, ?, ?, ?, 'pending')`,
      [input.firstName, input.lastName, input.nationalId, input.phone, input.province]
    );
    const [rows] = await pool.execute('SELECT * FROM registration_requests WHERE id = ?', [result.insertId]);
    await writeAudit({ eventType: 'DriverRegistrationRequested', subjectId: result.insertId, payload: { source: 'mobile-web' } });
    return response.status(201).json({
      message: 'درخواست ثبت‌نام راننده ثبت شد و پس از تأیید حساب ایجاد می‌شود.',
      registration: publicRegistration(rows[0])
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: 'ثبت درخواست انجام نشد؛ اتصال دیتابیس را بررسی کن.' });
  }
}

async function createCarrierRegistration(payload, response) {
  const input = carrierPayload(payload);
  const validationMessage = validateCarrier(input);
  if (validationMessage) return response.status(400).json({ message: validationMessage });

  try {
    const [existingAccount] = await pool.execute(
      'SELECT id FROM carriers WHERE identity_number = ? OR phone = ? LIMIT 1',
      [input.nationalIdentifier, input.phone]
    );
    const [existingRequest] = await pool.execute(
      `SELECT id FROM registration_requests
       WHERE role = 'carrier' AND status <> 'rejected'
         AND (national_identifier = ? OR phone = ? OR registration_number = ?) LIMIT 1`,
      [input.nationalIdentifier, input.phone, input.registrationNumber]
    );
    if (existingAccount.length || existingRequest.length) {
      return response.status(409).json({ message: 'این شناسه، شماره ثبت یا شماره تماس قبلاً ثبت شده است.' });
    }

    const [result] = await pool.execute(
      `INSERT INTO registration_requests
       (tenant_id, role, business_name, registration_number, national_identifier, manager_name, phone, province, status)
       VALUES ('platform', 'carrier', ?, ?, ?, ?, ?, ?, 'pending')`,
      [input.businessName, input.registrationNumber, input.nationalIdentifier, input.managerName, input.phone, input.province]
    );
    const [rows] = await pool.execute('SELECT * FROM registration_requests WHERE id = ?', [result.insertId]);
    await writeAudit({ eventType: 'CarrierRegistrationRequested', subjectType: 'carrier', subjectId: result.insertId, payload: { source: 'mobile-web' } });
    return response.status(201).json({
      message: 'درخواست ثبت‌نام کرییر ثبت شد و پس از تأیید حساب ایجاد می‌شود.',
      registration: publicRegistration(rows[0])
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: 'ثبت درخواست کرییر انجام نشد؛ اتصال دیتابیس را بررسی کن.' });
  }
}

app.get('/api/health', async (_request, response) => {
  try {
    await pingDatabase();
    response.json({ ok: true, service: 'gomrok-server', database: 'up', domain: 'gomrok.org' });
  } catch (error) {
    response.status(503).json({ ok: false, service: 'gomrok-server', database: 'down', message: error.message });
  }
});

app.post('/api/admin/login', (request, response) => {
  const username = String(request.body?.username || '').trim();
  const password = String(request.body?.password || '');
  if (username !== adminUsername || password !== adminPassword) {
    return response.status(401).json({ message: 'نام کاربری یا رمز عبور مدیر سیستم اشتباه است.' });
  }
  return response.json({ token: issueAdminToken(), admin: { username: adminUsername, role: 'super_admin' } });
});

async function listRegistrations(role, response) {
  try {
    const [rows] = await pool.execute(
      `SELECT id, role, first_name, last_name, national_id, phone, province,
              business_name, registration_number, national_identifier, manager_name,
              status, account_id, account_created_at, approved_at, approved_by,
              created_at, updated_at
       FROM registration_requests WHERE role = ? ORDER BY created_at DESC`,
      [role]
    );
    return response.json({ items: rows.map(publicRegistration) });
  } catch (error) {
    console.error(error);
    return response.status(503).json({ message: `فهرست ${roleConfig(role).plural} در دسترس نیست؛ اتصال دیتابیس را بررسی کن.` });
  }
}

app.get('/api/admin/summary', requireAdmin, async (_request, response) => {
  try {
    const [rows] = await pool.query(
      `SELECT role, COUNT(*) AS total,
              SUM(status = 'pending') AS pending,
              SUM(status = 'active') AS active,
              SUM(status = 'disabled') AS disabled
       FROM registration_requests GROUP BY role`
    );
    const summary = { drivers: 0, carriers: 0, pendingDrivers: 0, pendingCarriers: 0, activeDrivers: 0, activeCarriers: 0, disabledDrivers: 0, disabledCarriers: 0 };
    for (const row of rows) {
      const prefix = row.role === 'driver' ? 'Drivers' : 'Carriers';
      summary[row.role === 'driver' ? 'drivers' : 'carriers'] = Number(row.total || 0);
      summary[`pending${prefix}`] = Number(row.pending || 0);
      summary[`active${prefix}`] = Number(row.active || 0);
      summary[`disabled${prefix}`] = Number(row.disabled || 0);
    }
    return response.json(summary);
  } catch (error) {
    console.error(error);
    return response.status(503).json({ message: 'اطلاعات آماری در دسترس نیست؛ اتصال دیتابیس را بررسی کن.' });
  }
});

app.get('/api/admin/registrations/drivers', requireAdmin, (_request, response) => listRegistrations('driver', response));
app.get('/api/admin/registrations/carriers', requireAdmin, (_request, response) => listRegistrations('carrier', response));
// Backward-compatible aliases for the first version of the admin panel.
app.get('/api/admin/drivers', requireAdmin, (_request, response) => listRegistrations('driver', response));
app.get('/api/admin/carriers', requireAdmin, (_request, response) => listRegistrations('carrier', response));

app.post('/api/registrations/driver', (request, response) => createDriverRegistration(request.body || {}, response));
app.post('/api/registrations/carrier', (request, response) => createCarrierRegistration(request.body || {}, response));
// Keep the original public endpoints working while the new /app routes use
// the registration-request workflow.
app.post('/api/auth/register-driver', (request, response) => createDriverRegistration(request.body || {}, response));
app.post('/api/auth/register-carrier', (request, response) => createCarrierRegistration(request.body || {}, response));

function temporaryPassword() {
  return randomBytes(9).toString('base64url');
}

async function approveRegistration(role, id, adminUsernameValue) {
  const connection = await pool.getConnection();
  let generatedPassword = null;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT * FROM registration_requests WHERE id = ? AND role = ? FOR UPDATE', [id, role]);
    const registration = rows[0];
    if (!registration) {
      const error = new Error('درخواست ثبت‌نام پیدا نشد.');
      error.statusCode = 404;
      throw error;
    }

    let accountId = registration.account_id;
    if (accountId) {
      await connection.execute(`UPDATE ${roleConfig(role).table} SET status = 'active' WHERE id = ?`, [accountId]);
    } else {
      generatedPassword = temporaryPassword();
      const passwordHash = await bcrypt.hash(generatedPassword, 12);
      if (role === 'driver') {
        const [result] = await connection.execute(
          `INSERT INTO drivers
           (tenant_id, first_name, last_name, national_id, phone, province, city, password_hash, status)
           VALUES ('platform', ?, ?, ?, ?, ?, '', ?, 'active')`,
          [registration.first_name, registration.last_name, registration.national_id, registration.phone, registration.province, passwordHash]
        );
        accountId = result.insertId;
      } else {
        const managerName = String(registration.manager_name || '').slice(0, 80);
        const [result] = await connection.execute(
          `INSERT INTO carriers
           (tenant_id, carrier_type, business_name, registration_number, manager_first_name, manager_last_name,
            identity_number, phone, email, province, city, address, password_hash, status)
           VALUES ('platform', 'کرییر', ?, ?, ?, '', ?, ?, NULL, ?, '', NULL, ?, 'active')`,
          [registration.business_name, registration.registration_number, managerName, registration.national_identifier, registration.phone, registration.province, passwordHash]
        );
        accountId = result.insertId;
      }
    }

    await connection.execute(
      `UPDATE registration_requests
       SET status = 'active', account_id = ?, account_created_at = COALESCE(account_created_at, NOW()),
           approved_at = NOW(), approved_by = ?
       WHERE id = ?`,
      [accountId, adminUsernameValue, id]
    );
    await connection.commit();
    return { accountId, generatedPassword };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

app.patch('/api/admin/registrations/:role/:id/status', requireAdmin, async (request, response) => {
  const role = registrationRole(request.params.role);
  const id = Number(request.params.id);
  const action = String(request.body?.action || '').trim();
  if (!role || !Number.isInteger(id) || id < 1) return response.status(400).json({ message: 'شناسه درخواست معتبر نیست.' });

  try {
    if (action === 'approve') {
      const result = await approveRegistration(role, id, adminUsername);
      await writeAudit({ eventType: 'RegistrationApproved', subjectType: role, subjectId: id, payload: { accountId: result.accountId } });
      return response.json({ message: 'درخواست تأیید شد و حساب ایجاد یا فعال شد.', ...result });
    }

    const [rows] = await pool.execute('SELECT * FROM registration_requests WHERE id = ? AND role = ?', [id, role]);
    const registration = rows[0];
    if (!registration) return response.status(404).json({ message: 'درخواست ثبت‌نام پیدا نشد.' });

    if (action === 'disable' || action === 'enable') {
      const nextStatus = action === 'disable' ? 'disabled' : (registration.account_id ? 'active' : 'pending');
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        if (registration.account_id) {
          await connection.execute(`UPDATE ${roleConfig(role).table} SET status = ? WHERE id = ?`, [nextStatus, registration.account_id]);
        }
        await connection.execute('UPDATE registration_requests SET status = ? WHERE id = ?', [nextStatus, id]);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      await writeAudit({ eventType: action === 'disable' ? 'RegistrationDisabled' : 'RegistrationEnabled', subjectType: role, subjectId: id });
      return response.json({ message: action === 'disable' ? 'حساب غیرفعال شد.' : 'حساب فعال شد.' });
    }

    if (action === 'reject') {
      if (registration.account_id) return response.status(409).json({ message: 'حساب ایجادشده را نمی‌توان رد کرد؛ ابتدا آن را غیرفعال کن.' });
      await pool.execute("UPDATE registration_requests SET status = 'rejected' WHERE id = ?", [id]);
      await writeAudit({ eventType: 'RegistrationRejected', subjectType: role, subjectId: id });
      return response.json({ message: 'درخواست رد شد.' });
    }

    return response.status(400).json({ message: 'عملیات وضعیت شناخته نشد.' });
  } catch (error) {
    console.error(error);
    return response.status(error.statusCode || 500).json({ message: error.message || 'تغییر وضعیت انجام نشد.' });
  }
});

app.put('/api/admin/registrations/:role/:id', requireAdmin, async (request, response) => {
  const role = registrationRole(request.params.role);
  const id = Number(request.params.id);
  if (!role || !Number.isInteger(id) || id < 1) return response.status(400).json({ message: 'شناسه درخواست معتبر نیست.' });

  const input = role === 'driver' ? driverPayload(request.body || {}) : carrierPayload(request.body || {});
  const validationMessage = role === 'driver' ? validateDriver(input) : validateCarrier(input);
  if (validationMessage) return response.status(400).json({ message: validationMessage });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT * FROM registration_requests WHERE id = ? AND role = ? FOR UPDATE', [id, role]);
    const registration = rows[0];
    if (!registration) {
      await connection.rollback();
      return response.status(404).json({ message: 'درخواست ثبت‌نام پیدا نشد.' });
    }

    if (role === 'driver') {
      await connection.execute(
        `UPDATE registration_requests SET first_name = ?, last_name = ?, national_id = ?, phone = ?, province = ? WHERE id = ?`,
        [input.firstName, input.lastName, input.nationalId, input.phone, input.province, id]
      );
      if (registration.account_id) {
        await connection.execute(
          `UPDATE drivers SET first_name = ?, last_name = ?, national_id = ?, phone = ?, province = ? WHERE id = ?`,
          [input.firstName, input.lastName, input.nationalId, input.phone, input.province, registration.account_id]
        );
      }
    } else {
      await connection.execute(
        `UPDATE registration_requests
         SET business_name = ?, registration_number = ?, national_identifier = ?, manager_name = ?, phone = ?, province = ?
         WHERE id = ?`,
        [input.businessName, input.registrationNumber, input.nationalIdentifier, input.managerName, input.phone, input.province, id]
      );
      if (registration.account_id) {
        await connection.execute(
          `UPDATE carriers SET business_name = ?, registration_number = ?, manager_first_name = ?, identity_number = ?, phone = ?, province = ? WHERE id = ?`,
          [input.businessName, input.registrationNumber, input.managerName.slice(0, 80), input.nationalIdentifier, input.phone, input.province, registration.account_id]
        );
      }
    }
    await connection.commit();
    await writeAudit({ eventType: 'RegistrationUpdated', subjectType: role, subjectId: id });
    return response.json({ message: 'اطلاعات کاربر ویرایش شد.' });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ message: 'کد ملی، شناسه یا شماره تماس تکراری است.' });
    return response.status(500).json({ message: 'ویرایش اطلاعات انجام نشد.' });
  } finally {
    connection.release();
  }
});

app.delete('/api/admin/registrations/:role/:id', requireAdmin, async (request, response) => {
  const role = registrationRole(request.params.role);
  const id = Number(request.params.id);
  if (!role || !Number.isInteger(id) || id < 1) return response.status(400).json({ message: 'شناسه درخواست معتبر نیست.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT account_id FROM registration_requests WHERE id = ? AND role = ? FOR UPDATE', [id, role]);
    const registration = rows[0];
    if (!registration) {
      await connection.rollback();
      return response.status(404).json({ message: 'درخواست ثبت‌نام پیدا نشد.' });
    }
    if (registration.account_id) {
      await connection.execute(`DELETE FROM ${roleConfig(role).table} WHERE id = ?`, [registration.account_id]);
    }
    await connection.execute('DELETE FROM registration_requests WHERE id = ? AND role = ?', [id, role]);
    await connection.commit();
    await writeAudit({ eventType: 'RegistrationDeleted', subjectType: role, subjectId: id });
    return response.json({ message: 'اطلاعات کاربر حذف شد.' });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: 'حذف اطلاعات انجام نشد.' });
  } finally {
    connection.release();
  }
});

function excelCell(value) {
  return String(value ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function excelTable(role, rows) {
  const driver = role === 'driver';
  const headers = driver
    ? ['شناسه', 'نام', 'نام خانوادگی', 'کد ملی', 'شماره تماس', 'استان', 'وضعیت', 'تاریخ ثبت']
    : ['شناسه', 'نام شرکت', 'شماره ثبت', 'شناسه ملی', 'نام مدیرعامل', 'شماره تماس', 'استان', 'وضعیت', 'تاریخ ثبت'];
  const body = rows.map((row) => {
    const values = driver
      ? [row.id, row.first_name, row.last_name, row.national_id, row.phone, row.province, row.status, row.created_at]
      : [row.id, row.business_name, row.registration_number, row.national_identifier, row.manager_name, row.phone, row.province, row.status, row.created_at];
    return `<tr>${values.map((value) => `<td>${excelCell(value)}</td>`).join('')}</tr>`;
  }).join('');
  return `\uFEFF<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>body{font-family:Tahoma}table{border-collapse:collapse}th,td{border:1px solid #ccd6e0;padding:8px;white-space:nowrap}th{background:#e8f0fb}</style></head><body><table><thead><tr>${headers.map((header) => `<th>${excelCell(header)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

app.get('/api/admin/registrations/:role/export', requireAdmin, async (request, response) => {
  const role = registrationRole(request.params.role);
  if (!role) return response.status(400).json({ message: 'نوع کاربر معتبر نیست.' });
  try {
    const [rows] = await pool.execute(
      `SELECT id, first_name, last_name, national_id, phone, province,
              business_name, registration_number, national_identifier, manager_name, status, created_at
       FROM registration_requests WHERE role = ? ORDER BY created_at DESC`,
      [role]
    );
    const fileName = role === 'driver' ? 'gomrok-drivers.xls' : 'gomrok-carriers.xls';
    response.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return response.send(excelTable(role, rows));
  } catch (error) {
    console.error(error);
    return response.status(503).json({ message: 'خروجی اکسل آماده نشد.' });
  }
});

app.post('/api/auth/login', async (request, response) => {
  const phone = normalizeDigits(request.body?.phone).replace(/\s/g, '');
  const password = String(request.body?.password || '');
  if (!/^09\d{9}$/.test(phone) || !password) return response.status(400).json({ message: 'شماره تماس و رمز عبور را وارد کن.' });

  try {
    const [rows] = await pool.execute('SELECT * FROM drivers WHERE phone = ? LIMIT 1', [phone]);
    const driver = rows[0];
    if (!driver || driver.status !== 'active' || !driver.password_hash || !(await bcrypt.compare(password, driver.password_hash))) {
      return response.status(401).json({ message: 'حساب راننده فعال نیست یا اطلاعات ورود اشتباه است.' });
    }
    await writeAudit({ actorId: driver.id, eventType: 'DriverLoggedIn', subjectId: driver.id, payload: { source: 'mobile-web' } });
    return response.json({ token: issueToken(driver, 'driver'), user: publicDriver(driver) });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: 'ورود انجام نشد؛ اتصال دیتابیس را بررسی کن.' });
  }
});

app.post('/api/auth/login-carrier', async (request, response) => {
  const phone = normalizeDigits(request.body?.phone).replace(/\s/g, '');
  const password = String(request.body?.password || '');
  if (!/^09\d{9}$/.test(phone) || !password) return response.status(400).json({ message: 'شماره تماس و رمز عبور را وارد کن.' });

  try {
    const [rows] = await pool.execute('SELECT * FROM carriers WHERE phone = ? LIMIT 1', [phone]);
    const carrier = rows[0];
    if (!carrier || carrier.status !== 'active' || !carrier.password_hash || !(await bcrypt.compare(password, carrier.password_hash))) {
      return response.status(401).json({ message: 'حساب کرییر فعال نیست یا اطلاعات ورود اشتباه است.' });
    }
    await writeAudit({ actorId: carrier.id, eventType: 'CarrierLoggedIn', subjectType: 'carrier', subjectId: carrier.id, payload: { source: 'mobile-web' } });
    return response.json({ token: issueToken(carrier, 'carrier'), user: publicCarrier(carrier) });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: 'ورود کرییر انجام نشد؛ اتصال دیتابیس را بررسی کن.' });
  }
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Gomrok API: http://127.0.0.1:${port}`);
});
