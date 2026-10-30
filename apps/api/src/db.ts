import { Pool } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
const migrationDirectory = new URL('../migrations/', import.meta.url);
type Migration = { name: string; checksum: string; sql: string };
async function migrationFiles(directory = migrationDirectory): Promise<Migration[]> {
  const names = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort();
  const versions = new Set<string>();
  for (const name of names) {
    if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(name)) throw new Error(`迁移文件名须为 NNN_description.sql：${name}`);
    const version = name.slice(0, 3);
    if (versions.has(version)) throw new Error(`迁移编号重复：${version}`);
    versions.add(version);
  }
  if (!names.length) throw new Error('未找到数据库迁移文件');
  return Promise.all(names.map(async name => {
    const sql = await readFile(new URL(name, directory), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}
async function recordedMigrations(client: Pick<Pool, 'query'>) {
  const { rows: [table] } = await client.query("SELECT to_regclass('_schema_migrations') AS name");
  if (!table.name) return new Map<string, string>();
  const { rows } = await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM _schema_migrations ORDER BY name');
  return new Map(rows.map(row => [row.name, row.checksum]));
}
function validateChecksums(files: Migration[], applied: Map<string, string>) {
  for (const file of files) {
    if (applied.has(file.name) && applied.get(file.name) !== file.checksum) {
      throw new Error(`已执行的迁移被修改：${file.name}。请恢复原文件，并新增迁移文件。`);
    }
  }
}
export async function migrationStatus(directory = migrationDirectory) {
  const files = await migrationFiles(directory);
  const applied = await recordedMigrations(db());
  validateChecksums(files, applied);
  const names = new Set(files.map(file => file.name));
  return {
    migrations: files.map(file => ({ name: file.name, state: applied.has(file.name) ? 'applied' : 'pending' })),
    missingFiles: [...applied.keys()].filter(name => !names.has(name)),
  };
}
// Development startup and explicit deployment share the same versioned migration runner.
export async function initDatabase(directory = migrationDirectory) {
  const files = await migrationFiles(directory);
  const client = await db().connect();
  const executed: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':launchpad:migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS _schema_migrations (
      name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const applied = await recordedMigrations(client);
    validateChecksums(files, applied);
    const names = new Set(files.map(file => file.name));
    for (const name of applied.keys()) if (!names.has(name)) throw new Error(`已执行的迁移文件缺失：${name}`);
    const latest = [...applied.keys()].sort().at(-1);
    for (const file of files) {
      if (applied.has(file.name)) continue;
      if (latest && file.name < latest) throw new Error(`迁移编号必须递增：${file.name} 早于 ${latest}`);
      await client.query(file.sql);
      await client.query('INSERT INTO _schema_migrations(name, checksum) VALUES ($1, $2)', [file.name, file.checksum]);
      executed.push(file.name);
    }
    await client.query('COMMIT');
    return executed;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
// Vercel functions must never perform schema changes during cold starts.
export async function verifyDatabase() {
  const { migrations } = await migrationStatus();
  const pending = migrations.filter(file => file.state === 'pending');
  if (pending.length) throw new Error(`数据库存在待执行迁移：${pending.map(file => file.name).join(', ')}。请先运行 pnpm db:deploy。`);
}
export async function closeDatabase() {
  await pool?.end();
  pool = undefined;
}
