import { initDatabase, closeDatabase } from './db.js';
try {
  await initDatabase();
  console.log('PostgreSQL 数据表初始化完成');
} finally {
  await closeDatabase();
}
