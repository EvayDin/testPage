# Launchpad MVP

pnpm workspace 项目：Vue 3 前端 + Fastify 后端 + PostgreSQL。支持注册账户、自动登录进入主页、刷新恢复登录和退出。部署目标为单个 Vercel 项目

## 本地开发

macOS 本机独立数据库的安装、建库、连接配置、密码恢复与日常维护，请参阅 [PostgreSQL 详细指南](docs/postgresql-guide.md)。该方案使用 5433 端口，后端配置文件为 `apps/api/.env.local`。

需要 Node.js 24.12+ 和 pnpm 11。

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

初次请求会自动创建用户和会话表，因此首次部署只需设置连接字符串，数据库账号需要建表权限。也可以先执行 `pnpm db:migrate` 初始化。数据库必须已存在；代码不会创建数据库本身。

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
pnpm db:migrate   # 初始化 PostgreSQL 数据表
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
