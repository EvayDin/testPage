# Launchpad MVP

pnpm workspace 项目：Vue 3 前端 + Fastify 后端 + PostgreSQL。支持注册账户、自动登录进入主页、刷新恢复登录和退出。部署目标为单个 Vercel 项目

## 本地开发

macOS 本机独立数据库的安装、建库、连接配置、密码恢复与日常维护，请参阅 [PostgreSQL 详细指南](docs/postgresql-guide.md)。该方案使用 5433 端口，后端配置文件为 `apps/api/.env.local`。

需要 Node.js 24.12+ 和 pnpm 11。

部署到 Vercel 时，在项目的 Build and Deployment 设置中使用以下配置：

| 设置 | 值 |
| --- | --- |
| Root Directory | 仓库根目录（留空或 `./`），不要选择 `apps/api` 或 `apps/web` |
| Framework Preset | Other |
| Install Command | `pnpm install --frozen-lockfile` |
| Build Command | `pnpm build:vercel` |
| Output Directory | `apps/web/dist` |

如果报 `Command "build:vercel" not found`，先检查 Root Directory，再确认部署提交包含根目录 `package.json` 中的 `build:vercel`。该脚本只定义在仓库根目录；修正设置后，重新部署包含此脚本的提交。仓库根目录的 `vercel.json` 负责同时部署前端和 API。

1. 准备一个托管 PostgreSQL 数据库，例如通过 Vercel Marketplace 创建并连接 Neon，也可使用已有 PostgreSQL。
2. 将 `apps/api/.env.example` 复制为 `apps/api/.env.local`，填入真实的 `DATABASE_URL`。本地 `APP_ORIGIN` 保持 `http://localhost:5173`。
3. 安装依赖并启动：

```sh
pnpm install
pnpm dev
```

| 环境变量 | 配置 |
| --- | --- |
| `DATABASE_URL` | 托管 PostgreSQL 的连接字符串，优先使用服务商的连接池地址，保留 SSL 参数 |
| `APP_ORIGIN` | 实际站点地址，例如 `https://your-app.vercel.app`，不带尾部 `/`；自定义域名时填自定义域名 |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1`，按 `packageManager` 使用项目指定的 pnpm 版本 |

为使用到的 Production / Preview 环境配置数据库连接；建议使用独立的预览数据库。Vercel 的部署域名和生产域名自动纳入来源校验。Vercel 环境自动启用 Secure Cookie。

部署后的访问地址：

- `/register`：注册账户
- `/login`：登录
- `/`：登录后的主页
- `/api/auth/me`：当前用户接口
- `/health`：服务与数据库健康检查

`api/index.js` 是 Vercel Function 入口，复用 Fastify 应用，单个实例复用连接池；线上不会执行 `app.listen()`。静态文件由 Vercel 提供，前端深层路由回退到 `index.html`，`/api` 请求进入函数。连接池通过 Vercel 的 `attachDatabasePool` 管理闲置连接，参见[官方说明](https://vercel.com/kb/guide/connection-pooling-with-functions)。

Vercel 构建命令为 `pnpm build:vercel`：先构建，再运行 `pnpm db:deploy` 升级数据库，迁移失败则构建失败。线上 Function 冷启动仅检查迁移版本，不执行建表或改表。本地开发启动会自动执行待运行迁移。数据库必须已存在；代码不会创建数据库本身。

## 目录

```text
api/index.js              Vercel Function 入口
vercel.json               构建、静态页面和 API 路由配置
apps/
  web/                    Vue 3 + Vite + Vue Router + TypeScript
  api/                    Fastify + TypeScript + PostgreSQL
    migrations/           SQL 初始化脚本
    src/server.ts         本地监听入口
    src/vercel.ts         Vercel 请求处理入口
packages/shared/          共享 Zod 参数校验和用户类型
scripts/                  HTTP 集成测试与 Function 测试宿主
```

## 常用命令

```sh
pnpm dev          # 同时启动前后端开发服务
pnpm db:migrate   # 使用本地 .env.local 执行待运行迁移
pnpm db:status    # 查看已执行 / 待执行迁移
pnpm db:deploy    # 使用当前进程 DATABASE_URL 执行部署迁移
pnpm build:vercel # 构建成功后升级数据库
pnpm typecheck    # 检查全部包的类型
pnpm build        # 构建前后端与共享包；无需数据库连接
pnpm test         # 构建后端并执行真实 PostgreSQL HTTP 集成测试
pnpm test:vercel  # 使用 Vercel Function 入口执行同一套集成测试
pnpm start        # 使用构建结果在本地预览
```

分别启动应用前先执行 `pnpm --filter @mvp/shared build`。修改共享包后需重新构建共享包。

测试自动加载 `apps/api/.env.local`，可设置 `TEST_DATABASE_URL` 指向专用测试数据库（测试建议使用直接连接地址）。测试需要创建 schema 的权限，仅在随机创建的独立 schema 中操作，结束时清理。覆盖并发重复注册、注册事务回滚、登录、错误密码、会话过期与退出；Function 测试额外验证 Secure Cookie 和 Vercel 预览域名来源校验。

## 账户与数据

注册通过数据库事务创建账户与会话，邮箱唯一约束防止并发重复注册，失败时整体回滚，提交后才发送登录 Cookie。密码使用随机盐 + scrypt 哈希；浏览器使用 7 天有效期的 HttpOnly、SameSite=Lax Cookie；数据库仅保存会话令牌摘要。

| 接口 | 用途 |
| --- | --- |
| `POST /api/auth/register` | `{ name, email, password }`，注册并登录 |
| `POST /api/auth/login` | `{ email, password }`，登录 |
| `GET /api/auth/me` | 当前用户，未登录返回 401 |
| `POST /api/auth/logout` | 退出，立即使会话失效 |

当前未实现找回密码、邮箱验证、登录限流和管理后台。旧 SQLite 数据不会自动迁移到 PostgreSQL。

## 任务与习惯工作空间（第一、第二阶段）

登录后访问 `/` 进入个人工作空间。继续使用现有的邮箱、密码登录；显示名字可重复，邮箱唯一。

- **任务**：新建、编辑、删除，描述与可选截止时间，待开始 / 进行中 / 已完成三个状态；逾期标识；按标题搜索、状态和清单组合筛选；创建时间 / 截止时间排序。每页 12 项，删除末页任务后自动回到有效页面。
- **清单**：创建、重命名、删除；默认清单自动创建且不可删除、改名。删除普通清单时，事务内把任务转移到默认清单。
- **看板**：切换列表 / 看板，在三列之间拖动任务更新状态，保存失败恢复原状态。看板与列表使用同一分页范围，页脚提示当前页。
- **批量操作**：选择本页全部或部分任务，批量完成、移动和删除。批量操作会校验全部任务的所有权，任一项无效时整体回滚。
- **每日习惯**：添加、删除、当天打卡、撤销当天打卡，显示累计天数和最近七天记录。打卡日期统一按 `Asia/Shanghai`（北京时间）计算；重复请求与并发点击每天仅记一次。
- **数据概览**：全部任务数、完成数、逾期数、完成率与最近七天每日习惯打卡数。完成率按当前全部任务计算，图表按每天打卡次数计算。
- **异常处理**：表单保存失败保留输入，危险删除二次确认，加载与错误提示、空态、移动端适配；用户只能访问自己的任务、清单、习惯与统计。

正常执行 `pnpm dev` 即可启动；本地后端启动会按版本记录执行待运行 SQL，保留旧账号并补建默认清单；Vercel 在构建阶段运行迁移。也可执行 `pnpm db:migrate` 手动升级本地数据库。

### 新增接口

全部接口需要有效登录 Cookie，参数由共享 Zod schema 校验。

| 接口 | 用途 |
| --- | --- |
| `GET /api/lists` | 清单列表与任务数量 |
| `POST /api/lists` | 创建清单，`{ name }` |
| `PATCH /api/lists/:id` | 重命名普通清单，`{ name }` |
| `DELETE /api/lists/:id` | 删除普通清单并迁移任务 |
| `GET /api/tasks` | 查询任务，支持 `search/status/listId/sort/page/pageSize` |
| `GET /api/tasks/:id` | 查询自己的单个任务 |
| `POST /api/tasks` | 创建任务，`{ title, listId, description?, status?, dueAt? }` |
| `PATCH /api/tasks/:id` | 部分更新任务；清空截止时间传 `dueAt: null` |
| `DELETE /api/tasks/:id` | 删除任务 |
| `POST /api/tasks/batch` | `{ ids, action: "complete" / "move" / "delete", listId? }`；最多 100 项 |
| `GET /api/habits` | 习惯与打卡记录 |
| `POST /api/habits` | 新建习惯，`{ name }` |
| `DELETE /api/habits/:id` | 删除习惯及其打卡记录 |
| `PUT /api/habits/:id/check` | 幂等完成当天打卡 |
| `DELETE /api/habits/:id/check` | 幂等撤销当天打卡 |
| `GET /api/statistics` | 任务统计与七天打卡聚合 |

`dueAt` 使用带时区的 ISO 8601 字符串；前端把本地输入转换为 ISO 时间提交，列表按浏览器本地时区显示。任务排序 `sort=created` 表示创建时间倒序，`sort=due` 表示截止时间升序且未设截止时间的排最后。请求超出最后一页时，接口返回实际有效的 `page`。

### 学习代码入口

- `packages/shared/src/index.ts`：前后端共享类型、创建与部分更新参数校验。
- `apps/api/migrations/002_workspace.sql`：关系表、复合外键、唯一约束、索引。
- `apps/api/src/workspace.ts`：会话鉴权、参数化 SQL、事务、分页与统计。
- `apps/web/src/views/HomePage.vue`：筛选、分页、并发请求结果保护、批量操作、打卡与统计。
- `apps/web/src/components/TaskCard.vue`：Props / Emits 与拖拽交互。
- `apps/web/src/components/TaskEditor.vue`：原生模态对话框、表单校验与错误恢复。
- `scripts/workspace-checks.mjs`：真实 HTTP + PostgreSQL 集成测试，由 `pnpm test` 和 `pnpm test:vercel` 一并执行；测试使用独立 schema 并在结束后清理。


## 数据库迭代与 Vercel 部署

迁移指南见 [数据库迁移与发布](docs/database-migrations.md)。迁移文件放在 `apps/api/migrations/`，以三位递增编号命名。数据库的 `_schema_migrations` 表记录文件名、SHA-256 和执行时间，已执行的文件不再重跑，也不允许修改历史内容。

`db:migrate` 自动加载 `apps/api/.env.local`，用于本地；`db:deploy` 只使用当前进程的 `DATABASE_URL`，不自动加载本地连接，适用于 Vercel / CI。两条命令使用同一迁移引擎。

Vercel 中 Production 和 Preview 应配置各自独立的 `DATABASE_URL`。仓库的构建命令已设为 `pnpm build:vercel`；如果控制台手动覆盖了 Build Command，也需改成此命令。构建先通过，再执行待运行迁移；任何失败都会返回非零退出码。本地 `pnpm build` 仍不连接数据库。
