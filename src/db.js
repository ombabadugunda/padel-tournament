import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const connectionString =
  process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PGURL || '';

if (!connectionString) {
  console.error(
    'Не задано DATABASE_URL. На Railway додайте сервіс Postgres — змінна зʼявиться автоматично.',
  );
}

const needsSsl =
  /sslmode=require/.test(connectionString) ||
  (process.env.PGSSL === 'true' && !/localhost|127\.0\.0\.1/.test(connectionString));

export const pool = new pg.Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  max: 5,
});

export function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function initDb() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query(sql);
      console.log('Схема БД готова.');
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      console.warn(`БД ще не готова (${err.code || err.message}), спроба ${attempt}/${maxAttempts}…`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}
