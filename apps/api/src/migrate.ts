import { initDatabase, migrationStatus, closeDatabase } from './db.js';
try {
  if (process.argv.includes('--status')) {
    const { migrations, missingFiles } = await migrationStatus();
    for (const migration of migrations) console.log(`${migration.state === 'applied' ? '已执行' : '待执行'}  ${migration.name}`);
    for (const name of missingFiles) console.log(`文件缺失  ${name}`);
    if (missingFiles.length) process.exitCode = 1;
  } else {
    const executed = await initDatabase();
    for (const name of executed) console.log(`已执行  ${name}`);
    console.log(executed.length ? `数据库升级完成，共执行 ${executed.length} 个迁移` : '数据库已是最新版本，无需执行迁移');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : '数据库迁移失败');
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
