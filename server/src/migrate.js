import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import 'dotenv/config';

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true
});

try {
  const schema = await fs.readFile(path.resolve('schema.sql'), 'utf8');
  await connection.query(schema);

  try {
    await connection.query('ALTER TABLE gomrok.carriers ADD COLUMN registration_number VARCHAR(32) NULL AFTER business_name');
  } catch (error) {
    if (error.code !== 'ER_DUP_FIELDNAME') throw error;
  }

  // Bring accounts created by the first version of the app into the new
  // registration workspace without duplicating them on later migrations.
  await connection.query(`
    INSERT INTO registration_requests
      (tenant_id, role, first_name, last_name, national_id, phone, province,
       status, account_id, account_created_at, approved_at, approved_by, created_at, updated_at)
    SELECT d.tenant_id, 'driver', d.first_name, d.last_name, d.national_id, d.phone, d.province,
           d.status, d.id, d.created_at, d.created_at, 'legacy-migration', d.created_at, d.updated_at
    FROM drivers d
    WHERE NOT EXISTS (
      SELECT 1 FROM registration_requests r WHERE r.role = 'driver' AND r.account_id = d.id
    )
  `);

  await connection.query(`
    INSERT INTO registration_requests
      (tenant_id, role, business_name, registration_number, national_identifier,
       manager_name, phone, province, status, account_id, account_created_at,
       approved_at, approved_by, created_at, updated_at)
    SELECT c.tenant_id, 'carrier', c.business_name, NULL, c.identity_number,
           TRIM(CONCAT_WS(' ', c.manager_first_name, c.manager_last_name)), c.phone, c.province,
           c.status, c.id, c.created_at, c.created_at, 'legacy-migration', c.created_at, c.updated_at
    FROM carriers c
    WHERE NOT EXISTS (
      SELECT 1 FROM registration_requests r WHERE r.role = 'carrier' AND r.account_id = c.id
    )
  `);
  console.log('Gomrok MySQL schema is ready.');
} finally {
  await connection.end();
}
