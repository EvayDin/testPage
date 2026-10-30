import { workspaceChecks } from './workspace-checks.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const { Pool } = createRequire(new URL('../apps/api/package.json', import.meta.url))('pg');

const root = fileURLToPath(new URL('../', import.meta.url));
const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('测试需要 TEST_DATABASE_URL 或 DATABASE_URL');
const serverless = process.argv.includes('--serverless');
const schema = `test_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
const database = new Pool({ connectionString, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
let server;
const port = 13100 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
let logs = '';
function startServer() {
  server = spawn(process.execPath, [serverless ? join(root, 'scripts/serverless-server.mjs') : 'dist/server.js'], {
    cwd: join(root, 'apps/api'),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATABASE_URL: connectionString, DATABASE_SCHEMA: schema, APP_ORIGIN: 'http://localhost:5173', COOKIE_SECURE: 'false', VERCEL: serverless ? '1' : '', VERCEL_URL: 'launchpad-preview.vercel.app' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', chunk => { logs += chunk; });
  server.stderr.on('data', chunk => { logs += chunk; });
}
let cookie = '';
async function call(action, body, options = {}) {
  const response = await fetch(`${base}/api/auth/${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, data: await response.json() };
}
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  startServer();
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`后端启动失败：${logs}`);
    try { const health = await fetch(`${base}/health`); if (health.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert(ready, `等待后端超时：${logs}`);
  assert.equal((await call('me')).response.status, 401);
  assert.equal((await call('register', { name: '', email: 'bad', password: '123' })).response.status, 400);
  assert.equal((await call('register', { name: '测试用户', email: 'test@example.com', password: 'password123' }, { headers: { Origin: 'https://evil.example' } })).response.status, 403);
  const credentials = { name: '测试用户', email: ' Test@Example.com ', password: 'password123' };
  const registered = await call('register', credentials);
  assert.equal(registered.response.status, 201);
  assert.equal(registered.data.user.email, 'test@example.com');
  assert.equal(registered.data.user.name, '测试用户');
  assert(!('password_hash' in registered.data.user));
  const setCookie = registered.response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=lax/i);
  if (serverless) assert.match(setCookie, /; Secure/i);
  cookie = setCookie.split(';')[0];
  const firstCookie = cookie;
  assert.equal((await call('me')).data.user.id, registered.data.user.id);
  assert.equal((await call('register', credentials)).response.status, 409);
  assert.equal((await call('login', { email: 'test@example.com', password: 'wrongpassword' })).response.status, 401);
  assert.equal((await call('login', { email: 'missing@example.com', password: 'wrongpassword' })).response.status, 401);
  if (serverless) {
    assert.equal((await call('login', { email: 'missing@example.com', password: 'wrongpassword' }, { headers: { Origin: 'https://launchpad-preview.vercel.app' } })).response.status, 401, 'Vercel 预览域名应通过来源校验');
  }
  assert.equal((await call('logout', {})).response.status, 200);
  assert.equal((await call('me')).response.status, 401, '退出应使旧会话失效');
  const loggedIn = await call('login', credentials);
  assert.equal(loggedIn.response.status, 200);
  cookie = loggedIn.response.headers.get('set-cookie').split(';')[0];
  assert.notEqual(cookie, firstCookie);
  assert.equal((await call('me')).response.status, 200);
  const { rows: [row] } = await database.query('SELECT password_hash FROM users WHERE email = $1', ['test@example.com']);
  assert(!row.password_hash.includes(credentials.password));
  await workspaceChecks(base, cookie, database);
  await database.query("UPDATE sessions SET expires_at = NOW() - INTERVAL '1 second'");
  assert.equal((await call('me')).response.status, 401, '过期会话应被拒绝');
  const concurrent = await Promise.all([1, 2].map(() => call('register', { name: '并发测试', email: 'race@example.com', password: 'password123' })));
  assert.deepEqual(concurrent.map(result => result.response.status).sort(), [201, 409]);
  assert.equal((await database.query("SELECT COUNT(*)::int AS count FROM users WHERE email = 'race@example.com'")).rows[0].count, 1);
  await database.query(`CREATE FUNCTION reject_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test session failure'; END $$;
    CREATE TRIGGER reject_session BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION reject_session();`);
  const failedRegistration = await call('register', { name: '回滚测试', email: 'rollback@example.com', password: 'password123' });
  assert.equal(failedRegistration.response.status, 500);
  assert.equal(failedRegistration.response.headers.get('set-cookie'), null, '失败注册不应签发会话 Cookie');
  assert.equal((await database.query("SELECT COUNT(*)::int AS count FROM users WHERE email = 'rollback@example.com'")).rows[0].count, 0, '会话创建失败应回滚账户');
  console.log('✓ PostgreSQL：并发注册、事务回滚、注册、邮箱归一化、重复注册、参数校验、登录、错误密码、会话恢复、退出、会话过期、来源校验与密码存储检查通过');
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  if (server && server.exitCode === null) {
    const closed = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM');
    await closed;
  }
  await database.end();
  try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await admin.end(); }
}
