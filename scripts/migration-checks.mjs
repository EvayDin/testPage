import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { Pool } = createRequire(new URL('../apps/api/package.json', import.meta.url))('pg');
const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('迁移测试需要 TEST_DATABASE_URL 或 DATABASE_URL');
const schema = 'migration_' + randomUUID().replaceAll('-', '');
process.env.DATABASE_URL = connectionString;
process.env.DATABASE_SCHEMA = schema;
const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
const { db, initDatabase, closeDatabase, migrationStatus, verifyDatabase } = await import('../apps/api/dist/db.js');
const directory = await mkdtemp(join(tmpdir(), 'launchpad-migration-'));
const url = pathToFileURL(directory + '/');
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  // Production verification on an empty database must fail without creating anything.
  await assert.rejects(verifyDatabase(), /pnpm db:deploy/);
  assert.equal((await db().query("SELECT to_regclass('_schema_migrations') AS name")).rows[0].name, null);
  for (const name of ['001_init.sql', '002_workspace.sql']) {
    const sql = await readFile(new URL('../apps/api/migrations/' + name, import.meta.url), 'utf8');
    await writeFile(new URL(name, url), sql);
    await db().query(sql); // Simulate a legacy installation that has no migration ledger.
  }
  const account = randomUUID();
  await db().query('INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)', [account, '已有用户', 'legacy@example.com', 'fixture']);
  assert.deepEqual((await migrationStatus(url)).migrations.map(row => row.state), ['pending', 'pending']);
  assert.deepEqual(await initDatabase(url), ['001_init.sql', '002_workspace.sql']);
  assert.equal((await db().query('SELECT COUNT(*)::int AS count FROM users')).rows[0].count, 1);
  assert.equal((await db().query('SELECT COUNT(*)::int AS count FROM task_lists WHERE user_id=$1 AND is_default', [account])).rows[0].count, 1);
  assert.deepEqual(await initDatabase(url), []);
  assert.equal((await db().query('SELECT COUNT(*)::int AS count FROM _schema_migrations')).rows[0].count, 2);
  await verifyDatabase();
  const third = 'CREATE TABLE migration_fixture(id INT PRIMARY KEY); INSERT INTO migration_fixture VALUES(1);';
  await writeFile(new URL('003_fixture.sql', url), third);
  const concurrent = await Promise.all([initDatabase(url), initDatabase(url)]);
  assert.deepEqual(concurrent.map(result => result.length).sort(), [0, 1]);
  assert.equal((await db().query('SELECT COUNT(*)::int AS count FROM migration_fixture')).rows[0].count, 1);
  await writeFile(new URL('004_atomic.sql', url), 'CREATE TABLE rollback_fixture(id INT); INSERT INTO migration_fixture VALUES(2);');
  await writeFile(new URL('005_failure.sql', url), 'SELECT missing_column FROM missing_table_for_migration_test;');
  await assert.rejects(initDatabase(url));
  assert.equal((await db().query("SELECT to_regclass('rollback_fixture') AS name")).rows[0].name, null, '失败批次的 DDL 必须回滚');
  assert.equal((await db().query('SELECT COUNT(*)::int AS count FROM migration_fixture')).rows[0].count, 1, '失败批次的数据修改必须回滚');
  assert.equal((await db().query('SELECT COUNT(*)::int AS count FROM _schema_migrations')).rows[0].count, 3);
  await writeFile(new URL('005_failure.sql', url), 'INSERT INTO rollback_fixture VALUES(1);');
  assert.deepEqual(await initDatabase(url), ['004_atomic.sql', '005_failure.sql']);
  await writeFile(new URL('003_fixture.sql', url), third + '\n-- illegal history edit');
  await assert.rejects(initDatabase(url), /已执行的迁移被修改/);
  await assert.rejects(migrationStatus(url), /已执行的迁移被修改/);
  await writeFile(new URL('003_fixture.sql', url), third);
  await rename(new URL('003_fixture.sql', url), new URL('003_fixture.bak', url));
  await assert.rejects(initDatabase(url), /迁移文件缺失/);
  assert.deepEqual((await migrationStatus(url)).missingFiles, ['003_fixture.sql']);
  await rename(new URL('003_fixture.bak', url), new URL('003_fixture.sql', url));
  await writeFile(new URL('000_late.sql', url), 'SELECT 1;');
  await assert.rejects(initDatabase(url), /编号必须递增/);
  await rm(new URL('000_late.sql', url));
  await writeFile(new URL('005_duplicate.sql', url), 'SELECT 1;');
  await assert.rejects(initDatabase(url), /编号重复/);
  console.log('✓ 数据库迁移：旧库接管、版本记录、只执行一次、并发锁、批次回滚、失败重试、历史校验、缺失文件、顺序检查与线上只读检查通过');
} finally {
  await closeDatabase();
  try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
  finally { await admin.end(); await rm(directory, { recursive: true, force: true }); }
}
