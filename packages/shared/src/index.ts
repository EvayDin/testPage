import { z } from 'zod';

const email = z.string().trim().toLowerCase().email('请输入有效的邮箱地址').max(254);
const password = z.string().min(8, '密码至少需要 8 位').max(128, '密码不能超过 128 位');
export const loginSchema = z.object({ email, password });
export const registerSchema = loginSchema.extend({
  name: z.string().trim().min(1, '请输入你的名字').max(40, '名字不能超过 40 个字'),
});
export type PublicUser = { id: string; name: string; email: string; createdAt: string };
export type AuthResponse = { user: PublicUser };

export const taskStatusSchema = z.enum(['todo', 'doing', 'done']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export const idSchema = z.string().uuid('无效的记录 ID');
export const listSchema = z.object({ name: z.string().trim().min(1, '请输入清单名称').max(40) });
export const taskSchema = z.object({
  title: z.string().trim().min(1, '请输入任务标题').max(120, '标题最多 120 字'),
  description: z.string().max(4000).default(''),
  status: taskStatusSchema.default('todo'),
  listId: idSchema,
  dueAt: z.string().datetime({ offset: true }).nullable().default(null),
});
// PATCH must not inherit create-time defaults: a status change must preserve description and deadline.
export const taskPatchSchema = z.object({
  title: taskSchema.shape.title.optional(),
  description: z.string().max(4000).optional(),
  status: taskStatusSchema.optional(),
  listId: idSchema.optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
}).refine(value => Object.keys(value).length > 0, '请提供修改内容');
export const taskQuerySchema = z.object({
  search: z.string().trim().max(120).default(''),
  status: taskStatusSchema.optional(), listId: idSchema.optional(),
  sort: z.enum(['created', 'due']).default('created'),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});
export const batchSchema = z.object({
  ids: z.array(idSchema).min(1).max(100),
  action: z.enum(['complete', 'move', 'delete']), listId: idSchema.optional(),
}).refine(value => value.action !== 'move' || value.listId, '请选择目标清单');
export const habitSchema = z.object({ name: z.string().trim().min(1, '请输入习惯名称').max(80) });
export type TaskList = { id: string; name: string; isDefault: boolean; count: number };
export type Task = { id: string; title: string; description: string; status: TaskStatus; listId: string; dueAt: string | null; createdAt: string; overdue: boolean };
export type TaskPage = { tasks: Task[]; total: number; page: number; pageSize: number };
export type Habit = { id: string; name: string; checkedToday: boolean; totalDays: number; days: string[] };
export type Statistics = { total: number; done: number; overdue: number; completionRate: number; week: { date: string; count: number }[] };
