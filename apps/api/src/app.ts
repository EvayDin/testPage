import { workspaceRoutes } from './workspace.js';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { loginSchema, registerSchema, type PublicUser } from '@mvp/shared';
import { createSession, setSessionCookie, currentUser, hashPassword, logout, verifyPassword } from './auth.js';
import { db, initDatabase, verifyDatabase, closeDatabase } from './db.js';

export function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: 16 * 1024 });
  app.register(cookie);
  app.addHook('onReady', async () => {
    if (process.env.VERCEL) await verifyDatabase();
    else await initDatabase();
  });
  app.addHook('onClose', closeDatabase);
  app.setErrorHandler((error, request, reply) => {
    const status = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode : 500;
    if (status >= 500) request.log.error(error);
    return reply.code(status).send({ message: status >= 500 ? '服务暂时不可用，请稍后重试' : error instanceof Error ? error.message : '请求格式错误，请检查后重试' });
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (request.method === 'GET' || request.method === 'HEAD') return;
    const allowed = new Set([
      ...(process.env.VERCEL ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']),
      ...[process.env.APP_ORIGIN].filter((value): value is string => Boolean(value)),
      ...[process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
        .filter(Boolean).map(host => `https://${host}`),
    ]);
    const origin = request.headers.origin;
    if (origin && !allowed.has(origin)) return reply.code(403).send({ message: '请求来源不允许' });
  });
  app.get('/health', async () => {
    await db().query('SELECT 1');
    return { status: 'ok', service: 'launchpad-api' };
  });
  app.get('/api/auth/me', async (request, reply) => {
    const user = await currentUser(request);
    return user ? { user } : reply.code(401).send({ message: '请先登录' });
  });
  app.post('/api/auth/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.issues[0].message });
    const { name, email, password } = parsed.data;
    const user: PublicUser = { id: randomUUID(), name, email, createdAt: new Date().toISOString() };
    const passwordHash = await hashPassword(password);
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO users (id, name, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)',
        [user.id, name, email, passwordHash, user.createdAt]);
      await client.query('INSERT INTO task_lists (id, user_id, name, is_default) VALUES ($1, $2, $3, TRUE)', [randomUUID(), user.id, '默认清单']);
      const token = await createSession(user.id, request, client);
      await client.query('COMMIT');
      setSessionCookie(reply, token);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        return reply.code(409).send({ message: '该邮箱已注册，请直接登录' });
      }
      throw error;
    } finally {
      client.release();
    }
    return reply.code(201).send({ user });
  });
  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.issues[0].message });
    const { email, password } = parsed.data;
    const { rows } = await db().query('SELECT id, name, email, created_at AS "createdAt", password_hash FROM users WHERE email = $1', [email]);
    const row = rows[0] as (Omit<PublicUser, 'createdAt'> & { createdAt: Date; password_hash: string }) | undefined;
    // 未注册邮箱也执行密码派生，减少用户名枚举的时间差。
    const fallback = `${'0'.repeat(32)}:${'0'.repeat(128)}`;
    const valid = await verifyPassword(password, row?.password_hash ?? fallback);
    if (!row || !valid) return reply.code(401).send({ message: '邮箱或密码错误' });
    const token = await createSession(row.id, request);
    setSessionCookie(reply, token);
    const { password_hash: _hash, ...user } = row;
    return { user: { ...user, createdAt: user.createdAt.toISOString() } };
  });
  app.post('/api/auth/logout', async (request, reply) => {
    await logout(request, reply);
    return { message: '已退出登录' };
  });
  app.register(workspaceRoutes, { prefix: '/api' });
  return app;
}
