import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { attachDatabasePool } from '@vercel/functions';

let pool: Pool | undefined;
export function db() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('请设置 DATABASE_URL，连接你的 PostgreSQL 数据库');
    const schema = process.env.DATABASE_SCHEMA;
    if (schema && !/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('DATABASE_SCHEMA 格式不正确');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 5000,
      ...(schema ? { options: `-c search_path=${schema}` } : {}),
    });
    if (process.env.VERCEL) attachDatabasePool(pool);
    pool.on('error', error => console.error('PostgreSQL 连接异常:', error.message));
  }
  return pool;
}
export async function initDatabase() {
  const sql = await readFile(new URL('../migrations/001_init.sql', import.meta.url), 'utf8');
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // 同一 schema 下的并发启动串行建表。
    await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':launchpad:migrations'))");
    await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function closeDatabase() {
  await pool?.end();
  pool = undefined;
}
