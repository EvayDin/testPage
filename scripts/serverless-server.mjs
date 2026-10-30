// 测试用宿主：调用与 Vercel 相同的 Function 入口，不启动 Fastify 的监听器。
import { createServer } from 'node:http';
import handler from '../api/index.js';

createServer((request, response) => {
  handler(request, response).catch(error => {
    console.error(error);
    response.writeHead(500).end();
  });
}).listen(Number(process.env.PORT), '127.0.0.1');
