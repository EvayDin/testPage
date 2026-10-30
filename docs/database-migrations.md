# 数据库迁移与发布

## 命令

| 命令 | 用途 | 连接来源 |
| --- | --- | --- |
| `pnpm db:migrate` | 本地执行待运行迁移 | `apps/api/.env.local`，已有进程环境变量优先 |
| `pnpm db:status` | 显示已执行、待执行与文件缺失状态 | 同上 |
| `pnpm db:deploy` | Vercel / CI 执行待运行迁移 | 当前进程的 `DATABASE_URL`，不自动读本地配置 |
| `pnpm build:vercel` | 先构建，再运行 `db:deploy` | 当前部署环境 |

命令在数据库没有配置、连接失败、SQL 出错或历史文件校验失败时返回非零退出码。`db:status` 显示 pending 本身不算失败；历史被修改或文件缺失算失败。

## 新增字段的完整例子

假设下一次需要任务优先级，新增 `apps/api/migrations/003_task_priority.sql`：

```sql
ALTER TABLE tasks
  ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('low', 'normal', 'high'));
```

本文件只是用法示例，目前没有给业务增加优先级字段。以后新增迁移继续用 `004_...sql`，编号唯一且递增。已执行的 SQL 不改名、不删除、不修改，修正结构或数据时新增迁移。

1. 新增迁移 SQL，再修改对应的接口、共享类型和页面。
2. 运行 `pnpm db:status` 确认本地待执行文件。
3. 运行 `pnpm db:migrate` 升级本地数据库，然后验证业务。
4. 运行 `pnpm test`、`pnpm test:vercel`、`pnpm build`。
5. 一起提交代码和 SQL。Vercel 构建时先完成编译，再执行尚未执行的迁移，全部成功才继续发布。

已经运行过 `003` 的库，在下次部署时会跳过它，只执行 `004` 等新文件。不需要手工在数据库控制台复制 SQL，也不需要重建表。

## Vercel 设置

- 项目 Root Directory 使用仓库根目录。
- Build Command 使用仓库 `vercel.json` 中的 `pnpm build:vercel`。若控制台配置覆盖了仓库设置，需同步修改。
- Production 的 `DATABASE_URL` 指向生产库，Preview 指向独立预览库。部署会实际升级目标数据库，预览构建不应连接生产库。
- 使用可在整个迁移事务中保持连接的 PostgreSQL 地址；如果服务商提供直接连接地址，可用于部署迁移。
- 当前简化配置的构建和 Function 使用同一个 `DATABASE_URL`，因此该账号需要迁移涉及的建表、改表权限。需要分离权限时，可在 CI 中单独使用迁移账号执行 `db:deploy`，Function 使用业务账号。

Vercel 的环境变量在构建和 Function 执行时可读，并支持按 Production / Preview 分别配置，参见 [Vercel 环境变量](https://vercel.com/docs/environment-variables)。本地仅执行 `pnpm build` 不会改动数据库。

## 执行记录和失败处理

迁移引擎在 `_schema_migrations` 中保存：

- `name`：SQL 文件名。
- `checksum`：文件原始内容的 SHA-256，包含空格和换行。
- `applied_at`：迁移记录写入时间。

同一数据库 schema 的迁移使用 PostgreSQL 事务级 advisory lock 串行执行。加锁后重新读取版本，两个构建同时运行时也不会重复执行同一个迁移。锁等待最多 30 秒，超时后部署失败，可稍后重试。

一次命令中所有待运行 SQL 和对应版本记录放在同一事务。任一 SQL 出错，整个待执行批次回滚；此前成功发布的迁移保持不变。首次引入版本表时，现有 `001`、`002` 本身可重复执行，因此能接管已有数据库并保留业务数据；后续 SQL 由版本表保证只执行一次，无需全部写成 `IF NOT EXISTS`。

迁移文件不应包含 `BEGIN` / `COMMIT` / `ROLLBACK`，由引擎统一管理事务。当前引擎不支持 `CREATE INDEX CONCURRENTLY` 等不能在事务内运行的操作；大表索引或大规模回填应另外设计发布步骤。

## 发布兼容与回滚

迁移发生在新版本接流量之前，这期间旧版本仍可能处理请求，因此新增结构应兼容旧代码。例如先加有默认值的新字段、让代码兼容新旧结构，后续版本再清理旧字段。

回滚 Vercel 代码部署不会撤销数据库变化；本项目不自动执行数据库降级。若误改数据，需要备份恢复或新增修复迁移。删列、改列类型等变更应分阶段发布，不能假设切回旧代码就能恢复数据。

线上 Function 冷启动只核对当前代码所需迁移是否已执行以及校验和是否一致，不会创建版本表或执行 SQL 迁移。存在 pending 时会在日志中提示先执行 `pnpm db:deploy`，对外返回暂不可用。旧代码允许数据库存在额外的新版本记录，便于兼容性回滚；能否回滚仍取决于迁移是否兼容旧代码。

## 测试

`pnpm test` 包含迁移专项测试，验证旧库接管、重复执行、并发迁移、失败批次中 DDL 和数据的整体回滚、失败后重试、历史文件篡改、文件缺失、编号检查及线上只读版本检查。随后运行原有 HTTP 业务集成测试。

`pnpm test:vercel` 先在随机独立 schema 中执行部署迁移，再通过真实 Function 入口运行 HTTP 集成测试。两类测试结束后会清理自己的 schema。
