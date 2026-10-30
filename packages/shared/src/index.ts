import { z } from 'zod';

const email = z.string().trim().toLowerCase().email('请输入有效的邮箱地址').max(254);
const password = z.string().min(8, '密码至少需要 8 位').max(128, '密码不能超过 128 位');
export const loginSchema = z.object({ email, password });
export const registerSchema = loginSchema.extend({
  name: z.string().trim().min(1, '请输入你的名字').max(40, '名字不能超过 40 个字'),
});
export type PublicUser = { id: string; name: string; email: string; createdAt: string };
export type AuthResponse = { user: PublicUser };
