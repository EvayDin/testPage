import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';

let initialization: Promise<FastifyInstance> | undefined;
function getApp() {
  if (!initialization) {
    initialization = (async () => {
      const app = buildApp();
      try {
        await app.ready();
        return app;
      } catch (error) {
        await app.close();
        throw error;
      }
    })();
    // 数据库短暂不可用时，允许下一次请求重试初始化。
    initialization.catch(() => { initialization = undefined; });
  }
  return initialization;
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  try {
    const app = await getApp();
    app.server.emit('request', request, response);
  } catch (error) {
    console.error('API 初始化失败:', error instanceof Error ? error.message : '未知错误');
    response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ message: '服务暂时不可用，请稍后重试' }));
  }
}
