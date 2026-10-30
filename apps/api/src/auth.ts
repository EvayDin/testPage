import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PublicUser } from '@mvp/shared';
import type { PoolClient } from 'pg';
import { db } from './db.js';

const deriveKey = promisify(scrypt);
const COOKIE_NAME = 'mvp_session';
const TTL = 60 * 60 * 24 * 7;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const cookieOptions = () => ({ httpOnly: true, sameSite: 'lax' as const, secure: Boolean(process.env.VERCEL) || process.env.COOKIE_SECURE === 'true', path: '/' });

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = await deriveKey(password, salt, 64) as Buffer;
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, encoded] = stored.split(':');
  const hash = await deriveKey(password, salt, 64) as Buffer;
  const expected = Buffer.from(encoded, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}
export async function createSession(userId: string, request: FastifyRequest, client: Pick<PoolClient, 'query'> = db()) {
  const old = request.cookies[COOKIE_NAME];
  if (old) await client.query('DELETE FROM sessions WHERE token_hash = $1', [digest(old)]);
  const token = randomBytes(32).toString('hex');
  await client.query('DELETE FROM sessions WHERE expires_at <= NOW()');
  await client.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [digest(token), userId, new Date(Date.now() + TTL * 1000)]);
  return token;
}
export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: TTL });
}
export async function currentUser(request: FastifyRequest): Promise<PublicUser | null> {
  const token = request.cookies[COOKIE_NAME];
  if (!token) return null;
  const { rows } = await db().query(`SELECT u.id, u.name, u.email, u.created_at AS "createdAt"
    FROM users u JOIN sessions s ON s.user_id = u.id
    WHERE s.token_hash = $1 AND s.expires_at > NOW()`, [digest(token)]);
  const row = rows[0];
  return row ? { ...row, createdAt: row.createdAt.toISOString() } : null;
}
export async function logout(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[COOKIE_NAME];
  if (token) await db().query('DELETE FROM sessions WHERE token_hash = $1', [digest(token)]);
  reply.clearCookie(COOKIE_NAME, cookieOptions());
}
