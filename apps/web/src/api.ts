import { reactive } from 'vue';
import type { AuthResponse, PublicUser } from '@mvp/shared';
export const auth = reactive<{ user: PublicUser | null }>({ user: null });
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/auth/${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new ApiError('无法连接服务，请稍后再试', 0); }
  let result;
  try { result = await response.json(); } catch { throw new ApiError('服务暂时不可用，请稍后再试', response.status); }
  if (!response.ok) throw new ApiError(result.message || '请求失败，请重试', response.status);
  return result as T;
}
export async function refreshUser() {
  try { auth.user = (await request<AuthResponse>('me')).user; }
  catch (error) {
    auth.user = null;
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  }
}
