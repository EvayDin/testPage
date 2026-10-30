import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { batchSchema, habitSchema, idSchema, listSchema, taskPatchSchema, taskQuerySchema, taskSchema } from '@mvp/shared';
import { currentUser } from './auth.js';
import { db } from './db.js';

function failure(message: string, statusCode = 400): never { throw Object.assign(new Error(message), { statusCode }); }
function parse<T>(schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) failure(result.error.issues[0].message);
  return result.data;
}
const recordId = (request: FastifyRequest) => parse(idSchema, (request.params as { id: string }).id);
async function transaction<T>(run: (client: PoolClient) => Promise<T>) {
  const client = await db().connect();
  try { await client.query('BEGIN'); const value = await run(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function ownList(client: Pick<PoolClient, 'query'>, user: string, id: string) {
  if (!(await client.query('SELECT id FROM task_lists WHERE user_id=$1 AND id=$2 FOR SHARE', [user, id])).rowCount) failure('清单不存在', 404);
}
const taskColumns = `id, title, description, status, list_id AS "listId", due_at AS "dueAt", created_at AS "createdAt", (due_at < NOW() AND status <> 'done') IS TRUE AS overdue`;
const today = "(NOW() AT TIME ZONE 'Asia/Shanghai')::date";

export async function workspaceRoutes(app: FastifyInstance) {
  const owners = new WeakMap<FastifyRequest, string>();
  const user = (request: FastifyRequest) => owners.get(request)!;
  app.addHook('preHandler', async (request, reply) => {
    const account = await currentUser(request);
    if (!account) return reply.code(401).send({ message: '请先登录' });
    owners.set(request, account.id);
  });
  app.get('/lists', async request => {
    const { rows } = await db().query(`SELECT l.id, l.name, l.is_default AS "isDefault", COUNT(t.id)::int AS count
      FROM task_lists l LEFT JOIN tasks t ON t.list_id=l.id AND t.user_id=l.user_id
      WHERE l.user_id=$1 GROUP BY l.id ORDER BY l.is_default DESC, l.name, l.id`, [user(request)]);
    return { lists: rows };
  });
  app.post('/lists', async (request, reply) => {
    const { name } = parse(listSchema, request.body);
    const { rows } = await db().query('INSERT INTO task_lists(id,user_id,name) VALUES($1,$2,$3) RETURNING id,name,is_default AS "isDefault",0 AS count', [randomUUID(), user(request), name]);
    return reply.code(201).send({ list: rows[0] });
  });
  app.patch('/lists/:id', async request => {
    const { name } = parse(listSchema, request.body);
    const result = await db().query('UPDATE task_lists SET name=$1 WHERE id=$2 AND user_id=$3 AND NOT is_default RETURNING id', [name, recordId(request), user(request)]);
    if (!result.rowCount) failure('清单不存在或默认清单不可改名', 404);
    return { ok: true };
  });
  app.delete('/lists/:id', async request => transaction(async client => {
    const id = recordId(request), owner = user(request);
    const { rows } = await client.query('SELECT is_default FROM task_lists WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, owner]);
    if (!rows.length) failure('清单不存在', 404);
    if (rows[0].is_default) failure('不能删除默认清单');
    await client.query('UPDATE tasks SET list_id=(SELECT id FROM task_lists WHERE user_id=$1 AND is_default) WHERE list_id=$2 AND user_id=$1', [owner, id]);
    await client.query('DELETE FROM task_lists WHERE id=$1 AND user_id=$2', [id, owner]);
    return { ok: true };
  }));
  app.get('/tasks', async request => {
    const query = parse(taskQuerySchema, request.query);
    // One statement keeps total and requested page consistent under concurrent edits.
    const { rows } = await db().query(`WITH filtered AS (
      SELECT ${taskColumns} FROM tasks WHERE user_id=$1
      AND ($2::text='' OR strpos(lower(title),lower($2))>0)
      AND ($3::text IS NULL OR status=$3) AND ($4::uuid IS NULL OR list_id=$4)
    ), counted AS (SELECT COUNT(*)::int AS total FROM filtered), paged AS (
      SELECT * FROM filtered ORDER BY ${query.sort === 'due' ? '"dueAt" ASC NULLS LAST' : '"createdAt" DESC'}, id
      LIMIT $5 OFFSET (LEAST($6,GREATEST(1,CEIL((SELECT total FROM counted)::numeric/$5)::int))-1)*$5
    ) SELECT counted.total, LEAST($6,GREATEST(1,CEIL(total::numeric/$5)::int)) AS page,
      COALESCE((SELECT json_agg(paged) FROM paged),'[]') AS tasks FROM counted`,
    [user(request), query.search, query.status ?? null, query.listId ?? null, query.pageSize, query.page]);
    return { ...rows[0], pageSize: query.pageSize };
  });
  app.get('/tasks/:id', async request => {
    const { rows } = await db().query(`SELECT ${taskColumns} FROM tasks WHERE id=$1 AND user_id=$2`, [recordId(request), user(request)]);
    if (!rows.length) failure('任务不存在', 404);
    return { task: rows[0] };
  });
  app.post('/tasks', async (request, reply) => {
    const data = parse(taskSchema, request.body);
    const task = await transaction(async client => {
      await ownList(client, user(request), data.listId);
      const { rows } = await client.query(`INSERT INTO tasks(id,user_id,list_id,title,description,status,due_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${taskColumns}`,
        [randomUUID(), user(request), data.listId, data.title, data.description, data.status, data.dueAt]);
      return rows[0];
    });
    return reply.code(201).send({ task });
  });
  app.patch('/tasks/:id', async request => transaction(async client => {
    const data = parse(taskPatchSchema, request.body);
    if (data.listId) await ownList(client, user(request), data.listId);
    const mapping = { title: 'title', description: 'description', status: 'status', listId: 'list_id', dueAt: 'due_at' };
    const entries = Object.entries(data);
    const assignments = entries.map(([key], index) => `${mapping[key as keyof typeof mapping]}=$${index + 3}`);
    const { rows } = await client.query(`UPDATE tasks SET ${assignments.join(',')} WHERE id=$1 AND user_id=$2 RETURNING ${taskColumns}`,
      [recordId(request), user(request), ...entries.map(([, value]) => value)]);
    if (!rows.length) failure('任务不存在', 404);
    return { task: rows[0] };
  }));
  app.delete('/tasks/:id', async request => {
    const result = await db().query('DELETE FROM tasks WHERE id=$1 AND user_id=$2', [recordId(request), user(request)]);
    if (!result.rowCount) failure('任务不存在', 404);
    return { ok: true };
  });
  app.post('/tasks/batch', async request => transaction(async client => {
    const data = parse(batchSchema, request.body), ids = [...new Set(data.ids)];
    if (data.action === 'move') await ownList(client, user(request), data.listId!);
    const selected = await client.query('SELECT id FROM tasks WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE', [user(request), ids]);
    if (selected.rowCount !== ids.length) failure('部分任务不存在，请刷新后重试', 404);
    const where = 'WHERE user_id=$1 AND id=ANY($2::uuid[])';
    if (data.action === 'delete') await client.query(`DELETE FROM tasks ${where}`, [user(request), ids]);
    else if (data.action === 'complete') await client.query(`UPDATE tasks SET status='done' ${where}`, [user(request), ids]);
    else await client.query(`UPDATE tasks SET list_id=$3 ${where}`, [user(request), ids, data.listId]);
    return { count: ids.length };
  }));
  app.get('/habits', async request => {
    const { rows } = await db().query(`SELECT h.id,h.name,EXISTS(SELECT 1 FROM habit_checks c WHERE c.habit_id=h.id AND c.checked_on=${today}) AS "checkedToday",
      (SELECT COUNT(*)::int FROM habit_checks c WHERE c.habit_id=h.id) AS "totalDays",
      COALESCE((SELECT json_agg(to_char(c.checked_on,'YYYY-MM-DD') ORDER BY c.checked_on) FROM habit_checks c WHERE c.habit_id=h.id AND c.checked_on BETWEEN ${today}-6 AND ${today}),'[]') AS days
      FROM habits h WHERE h.user_id=$1 ORDER BY h.created_at,h.id`, [user(request)]);
    return { habits: rows };
  });
  app.post('/habits', async (request, reply) => {
    const data = parse(habitSchema, request.body);
    const { rows } = await db().query('INSERT INTO habits(id,user_id,name) VALUES($1,$2,$3) RETURNING id,name', [randomUUID(), user(request), data.name]);
    return reply.code(201).send({ habit: rows[0] });
  });
  app.delete('/habits/:id', async request => {
    const result = await db().query('DELETE FROM habits WHERE id=$1 AND user_id=$2', [recordId(request), user(request)]);
    if (!result.rowCount) failure('习惯不存在', 404);
    return { ok: true };
  });
  for (const method of ['PUT', 'DELETE'] as const) app.route({ method, url: '/habits/:id/check', handler: async request => transaction(async client => {
    const id = recordId(request);
    if (!(await client.query('SELECT id FROM habits WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, user(request)])).rowCount) failure('习惯不存在', 404);
    if (method === 'PUT') await client.query(`INSERT INTO habit_checks(habit_id,checked_on) VALUES($1,${today}) ON CONFLICT DO NOTHING`, [id]);
    else await client.query(`DELETE FROM habit_checks WHERE habit_id=$1 AND checked_on=${today}`, [id]);
    return { ok: true };
  }) });
  app.get('/statistics', async request => {
    const { rows: [counts] } = await db().query(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE status='done')::int AS done,
      COUNT(*) FILTER(WHERE status<>'done' AND due_at<NOW())::int AS overdue FROM tasks WHERE user_id=$1`, [user(request)]);
    const { rows: week } = await db().query(`SELECT to_char(d.day,'YYYY-MM-DD') AS date, COUNT(c.habit_id)::int AS count
      FROM generate_series(${today}-6,${today},INTERVAL '1 day') d(day)
      LEFT JOIN (habit_checks c JOIN habits h ON h.id=c.habit_id AND h.user_id=$1) ON c.checked_on=d.day::date
      GROUP BY d.day ORDER BY d.day`, [user(request)]);
    return { ...counts, completionRate: counts.total ? Math.round(counts.done / counts.total * 100) : 0, week };
  });
}
